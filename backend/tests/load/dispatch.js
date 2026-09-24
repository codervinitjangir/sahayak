/*
 * Dispatch concurrency load test.
 *
 *   cd backend
 *   uvicorn app.main:app --port 8010          # in another shell
 *   python tests/load/seed_dispatch_load.py   # once
 *
 *   k6 run -e SCENARIO=baseline tests/load/dispatch.js
 *   k6 run -e SCENARIO=spike    tests/load/dispatch.js
 *   k6 run -e SCENARIO=mixed    tests/load/dispatch.js   # with the responder running
 *
 * WHY ONE SCENARIO PER INVOCATION
 * -------------------------------
 * k6 can run all three in one process with startTime offsets, and that would be
 * shorter. It is not done, for two reasons that both come down to being able to
 * trust the numbers:
 *
 *   * A ramping-arrival-rate scenario that has just pushed the server to its
 *     limit leaves a tail — queued work, a warm connection pool, rows in
 *     job_assignments — and the next scenario would measure that tail as if it
 *     were its own baseline. Separate runs make each scenario's starting state
 *     the same starting state.
 *
 *   * The interesting metrics are not k6's. Matching accuracy, deadlock count and
 *     per-job dispatch latency all come out of Postgres afterwards, and they are
 *     separable per scenario only because each scenario stamps its own tag into
 *     issue_description. Overlapping runs would blur that.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * ----------------------------------------
 * POST /api/v1/jobs runs the whole matching pipeline synchronously — Redis
 * GEOSEARCH, the eligibility query, scoring, and the assignment write all happen
 * before the 201 comes back. So http_req_duration here *is* dispatch latency plus
 * HTTP overhead, which is why this file can report the spec's core metric at all.
 *
 * It does not measure the Redis leg in isolation; nothing on the client side can.
 * That is collect_dispatch_load.py's job.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const ctx = JSON.parse(open('./load-context.json'));

const SCENARIO = (__ENV.SCENARIO || 'baseline').toLowerCase();
const RUN_ID = __ENV.RUN_ID || `${SCENARIO}`;

const KM_PER_DEG_LAT = 111.32;

// ---------------------------------------------------------------------------
// Custom metrics. http_req_duration already covers latency, but it covers every
// request including the failures, and a 500 that returns in 4 ms would flatter
// the percentiles. These are scoped to the requests that actually dispatched.
// ---------------------------------------------------------------------------
const dispatchLatency = new Trend('dispatch_latency_ms', true);
const matchedRate = new Rate('dispatch_matched');      // 201 + status 'matching'
const createdOk = new Counter('jobs_created');
const noMatch = new Counter('jobs_no_match_found');
const errors = new Counter('jobs_errored');
const serverErrors = new Counter('http_5xx');
const clientErrors = new Counter('http_4xx');

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
// preAllocatedVUs is set well above the arrival rate on purpose. An
// arrival-rate executor that runs out of VUs stops *arriving* and records
// dropped_iterations, which would read as "the load generator gave up" rather
// than "the server is slow" — the two are easy to confuse in a report, and only
// one of them is a finding about the server.
const SCENARIOS = {
  // Not one of the three measured scenarios. A short warm-up pass, because the
  // very first request through a cold process pays for things no later request
  // pays for again — establishing the first asyncpg connection to a pooler two
  // thousand kilometres away, the first Redis connect, and the one-off fetch of
  // Supabase's JWKS that token verification caches. Measured once, that cost was
  // 25 s on a single request, which would sit in the p99 of a 2-minute run and
  // make the report wrong in the one direction nobody would question.
  smoke: {
    executor: 'constant-arrival-rate',
    rate: 2,
    timeUnit: '1s',
    duration: '15s',
    preAllocatedVUs: 10,
    maxVUs: 40,
  },
  baseline: {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1s',
    duration: '2m',
    preAllocatedVUs: 150,
    maxVUs: 800,
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 400,
    maxVUs: 2500,
    stages: [
      { target: 100, duration: '30s' },   // ramp up
      { target: 100, duration: '1m' },    // sustain
      { target: 10, duration: '30s' },    // ramp down
    ],
  },
  // Same arrival rate as baseline, deliberately. The only difference between the
  // two runs is that partners and owners are concurrently answering offers
  // (responder_dispatch_load.py), so the latency delta between baseline and mixed
  // is attributable to concurrent writes against the same rows and nothing else.
  mixed: {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1s',
    duration: '2m',
    preAllocatedVUs: 150,
    maxVUs: 800,
  },

  // Not one of the three specified scenarios. `mixed` at the specified 10/s failed
  // 31 % of its job creations, which bounds the ceiling from above but not from
  // below — without a rate that runs clean, the report could only quote a range.
  // This exists to find that rate. It carries its own name so its jobs are tagged
  // `LOAD-QA mixed_calib ...` and can never be pooled with the measured run's data.
  mixed_calib: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.RATE || 4),
    timeUnit: '1s',
    duration: __ENV.CALIB_DURATION || '90s',
    preAllocatedVUs: 100,
    maxVUs: 400,
  },
};

if (!SCENARIOS[SCENARIO]) {
  throw new Error(`unknown SCENARIO='${SCENARIO}' (smoke | baseline | spike | mixed | mixed_calib)`);
}

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },
  discardResponseBodies: false,   // the body carries matching vs no_match_found
  summaryTrendStats: ['min', 'med', 'avg', 'p(95)', 'p(99)', 'max'],
  // No abortOnFail anywhere. The point of the spike run is to find where this
  // breaks; a threshold that killed the run on the first 500 would destroy the
  // evidence it exists to collect.
  thresholds: {},
};

// ---------------------------------------------------------------------------
// Pickup jitter
// ---------------------------------------------------------------------------
function jitteredPickup() {
  // sqrt on the radius gives a uniform distribution over the disc. Without it
  // points bunch toward the centre, which would quietly make every job's
  // candidate ordering more alike than intended.
  const r = ctx.jitter_km * Math.sqrt(Math.random());
  const bearing = Math.random() * 2 * Math.PI;
  const lat = ctx.pickup.lat + (r * Math.cos(bearing)) / KM_PER_DEG_LAT;
  const lng =
    ctx.pickup.lng +
    (r * Math.sin(bearing)) / (KM_PER_DEG_LAT * Math.cos((ctx.pickup.lat * Math.PI) / 180));
  return { lat, lng };
}

export default function () {
  // Spread across owners so no single user_id becomes a write hotspot — the
  // contention this test is looking for is on the partner rows, and an artificial
  // queue on one owner would be indistinguishable from it.
  const owner = ctx.owners[(__VU + __ITER) % ctx.owners.length];
  const pickup = jitteredPickup();

  const res = http.post(
    `${ctx.base_url}/api/v1/jobs`,
    JSON.stringify({
      vehicle_id: owner.vehicle_id,
      service_code: ctx.service_code,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      pickup_address_text: 'CG Road, Ahmedabad',
      // The tag is what lets the collector separate this scenario's jobs from
      // the other two runs' — and what lets purge find them all afterwards.
      issue_description: `${ctx.job_tag} ${RUN_ID} vu${__VU} it${__ITER}`,
    }),
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
      },
      tags: { name: 'POST /api/v1/jobs', scenario_run: RUN_ID },
      timeout: '60s',
    },
  );

  let jobStatus = null;
  if (res.status === 201) {
    try {
      jobStatus = res.json('data.status');
    } catch (e) {
      jobStatus = 'unparseable';
    }
    createdOk.add(1);
    dispatchLatency.add(res.timings.duration);
    matchedRate.add(jobStatus === 'matching');
    if (jobStatus === 'no_match_found') noMatch.add(1);
  } else {
    errors.add(1);
    if (res.status >= 500 || res.status === 0) serverErrors.add(1);
    else if (res.status >= 400) clientErrors.add(1);
  }

  check(res, {
    'job created (201)': (r) => r.status === 201,
    'a partner was matched': () => jobStatus === 'matching',
  });
}

export function handleSummary(data) {
  const out = {};
  out[`tests/load/results/k6-${RUN_ID}.json`] = JSON.stringify(data, null, 1);
  out.stdout = textSummaryFallback(data);
  return out;
}

// k6's own textSummary lives in a remote jslib module. Pulling it in would make
// the run depend on network access at start-up, which is the last thing a
// latency measurement needs, so the handful of lines that matter are printed
// here instead.
function textSummaryFallback(data) {
  const m = data.metrics || {};
  const v = (metric, key, dflt) => {
    const entry = m[metric];
    if (!entry || !entry.values) return dflt;
    const val = entry.values[key];
    return val === undefined || val === null ? dflt : val;
  };
  const f = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : String(x));
  const L = 'dispatch_latency_ms';
  const lines = [
    '',
    `======== ${RUN_ID} ========`,
    `duration            ${f(data.state.testRunDurationMs / 1000, 1)} s`,
    `iterations          ${v('iterations', 'count', 0)}`,
    `dropped_iterations  ${v('dropped_iterations', 'count', 0)}`,
    `jobs created        ${v('jobs_created', 'count', 0)}`,
    `  of which matched  ${f(100 * v('dispatch_matched', 'rate', 0), 1)} %`,
    `  no_match_found    ${v('jobs_no_match_found', 'count', 0)}`,
    `errors (non-201)    ${v('jobs_errored', 'count', 0)}` +
      `   [5xx/timeout ${v('http_5xx', 'count', 0)}, 4xx ${v('http_4xx', 'count', 0)}]`,
    `throughput          ${f(v('http_reqs', 'rate', 0), 2)} req/s`,
    '',
    'dispatch latency (successful creations only, ms)',
    `  min ${f(v(L, 'min', 0))}` +
      `  p50 ${f(v(L, 'med', 0))}` +
      `  avg ${f(v(L, 'avg', 0))}` +
      `  p95 ${f(v(L, 'p(95)', 0))}` +
      `  p99 ${f(v(L, 'p(99)', 0))}` +
      `  max ${f(v(L, 'max', 0))}`,
    '',
  ];
  return lines.join('\n') + '\n';
}
