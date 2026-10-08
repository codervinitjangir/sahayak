/**
 * Every path this app can emit must be a path the backend actually serves.
 *
 * This is the test that was missing. The suite already had `contract.test.ts`,
 * which asserts request bodies and response handling against a mocked `fetch` —
 * and a mocked transport answers any URL you give it, so that file happily
 * asserted a `PATCH /vehicles/{id}` and a `GET /users/{id}` that have never
 * existed on the backend. Four such calls were live in `src/` on 2026-10-06, one
 * of them (`GET /jobs/me`) in the mobile app as well. Every one of them was
 * green in a mocked test and a 404 in a browser.
 *
 * So this test does not mock anything. It reads the paths out of the source and
 * compares them with the backend's own OpenAPI inventory, exported by
 * `backend/tools/export_routes.py` into `tests/fixtures/backend-routes.json`.
 *
 * ## When this fails
 *
 * Either the frontend is calling something that is not there — fix the call — or
 * the backend route list has moved and the fixture is stale. Re-export it:
 *
 *     cd backend && python tools/export_routes.py
 *
 * A stale fixture failing loudly is the point. The alternative, a test that pings
 * a running server, passes vacuously the moment nobody is running one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import inventory from '../fixtures/backend-routes.json';

const SRC = join(__dirname, '..', '..', 'src');
const API_PREFIX = '/api/v1';

/** "GET /api/v1/vehicles" — the fixture's format. */
const SERVED = new Set<string>(inventory.routes);

interface CallSite {
  file: string;
  method: string;
  path: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Turn a template literal into its OpenAPI shape.
 *
 * `/jobs/${jobId}/cancel` → `/jobs/{x}/cancel`, and the fixture's
 * `/jobs/{job_id}/cancel` is normalised the same way, so the comparison is on
 * path *structure* and does not care that the backend calls it `job_id` while the
 * frontend variable is `jobId`.
 *
 * Query strings are dropped: they are not part of the route, and FastAPI never
 * puts them in a path. That covers both a literal `?limit=20` and an interpolated
 * `${query}` holding one — the latter would otherwise read as an extra path
 * segment and look like a route that does not exist.
 */
function normalise(path: string): string {
  const withoutQuery = path.split('?')[0];
  return (
    withoutQuery
      .replace(/\$\{[^}]*\}/g, '{x}')
      .replace(/\{[^}]*\}/g, '{x}')
      // A placeholder glued to the end of a segment rather than following a "/"
      // is an interpolated query string, not a path parameter.
      .replace(/([^/]){x}$/, '$1')
  );
}

/**
 * Find `apiClient<...>('/path', { method: 'POST' })` call sites.
 *
 * Deliberately a source scan rather than runtime interception: a call site that
 * only runs on a branch no test exercises is exactly the one that rots, and this
 * finds it without needing to reach it. The cost is that a path built by string
 * concatenation is invisible here — which the last assertion in this file turns
 * into a failure rather than a silent gap.
 */
function collectCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  // apiClient, optionally generic, then the first argument as a quoted or
  // backticked literal. The method is read from the options object that follows.
  //
  // The trailing window is a *lookahead*, not a capture. As a capture it consumed
  // those 220 characters, so `matchAll` resumed past them and silently skipped
  // every call site that happened to sit within one window of another — which in
  // this codebase is most of them, since the service modules put their calls a few
  // lines apart. The first version of this test found 2 of the 4 calls in
  // vehicles.service.ts and reported a clean run.
  const call = /apiClient\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\1(?=([\s\S]{0,220}))/g;

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(call)) {
      const [, , rawPath, trailing] = match;
      const methodMatch = /method\s*:\s*['"`](GET|POST|PATCH|PUT|DELETE)['"`]/i.exec(trailing);
      sites.push({
        file: relative(join(__dirname, '..', '..'), file).replace(/\\/g, '/'),
        // `fetch` defaults to GET, and so does apiClient when no method is given.
        method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
        path: rawPath,
      });
    }
  }
  return sites;
}

const CALL_SITES = collectCallSites();

describe('every apiClient path exists on the backend', () => {
  it('finds the call sites at all', () => {
    // Guards against the regex above silently matching nothing after a refactor,
    // which would turn this whole file into a test that always passes. The number
    // is a floor, not the exact count: adding a call should not fail this.
    expect(CALL_SITES.length).toBeGreaterThan(20);
  });

  it('has no call site whose method+path the backend does not serve', () => {
    const servedShapes = new Set([...SERVED].map((route) => {
      const [method, path] = route.split(' ');
      return `${method} ${normalise(path)}`;
    }));

    const unknown = CALL_SITES.filter((site) => {
      // Paths starting with http are absolute and point somewhere else entirely
      // (nothing does today); skip rather than mis-report them.
      if (site.path.startsWith('http')) return false;
      const full = site.path.startsWith(API_PREFIX) ? site.path : `${API_PREFIX}${site.path}`;
      return !servedShapes.has(`${site.method} ${normalise(full)}`);
    });

    expect(
      unknown.map((site) => `${site.method} ${site.path}  (${site.file})`),
      'These calls have no matching backend route. Either the path is wrong, or ' +
        'the route list changed and tests/fixtures/backend-routes.json is stale — ' +
        're-export it with: cd backend && python tools/export_routes.py'
    ).toEqual([]);
  });

  it('reaches the routes the owner and partner journeys depend on', () => {
    // A path-existence check passes trivially if the app stops calling anything.
    // These are the calls without which there is no demo: request help, track it,
    // answer an offer, work the job.
    const required = [
      'POST /jobs',
      'GET /jobs/${jobId}',
      'POST /jobs/${jobId}/cancel',
      'POST /jobs/${jobId}/status',
      'GET /partners/me/offers',
      'POST /job-assignments/${offerId}/respond',
      'POST /partners/${partnerId}/link-auth',
      'GET /notifications${query}',
      'GET /auth/me',
    ];
    const present = new Set(CALL_SITES.map((s) => `${s.method} ${s.path}`));
    for (const route of required) {
      expect(present.has(route), `${route} is no longer called anywhere in src/`).toBe(true);
    }
  });

  it('builds every path from a literal, so this test can see it', () => {
    // A concatenated path (`'/jobs/' + id`) would not be matched by the scan
    // above, and an unmatched path is an unchecked path. Keeping them literal is
    // a cheap constraint that keeps this file honest.
    const concatenated: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/apiClient\s*(?:<[^>]*>)?\s*\(\s*([^'"`\s)][^,)]*)/g)) {
        const firstArg = match[1].trim();
        // A bare identifier is fine when it was assembled from a literal just
        // above — notifications.service.ts builds its query string that way — so
        // only flag concatenation, which is the form that hides the base path.
        if (firstArg.includes('+')) {
          concatenated.push(`${relative(join(__dirname, '..', '..'), file).replace(/\\/g, '/')}: ${firstArg}`);
        }
      }
    }
    expect(concatenated, 'Build request paths as template literals, not with "+"').toEqual([]);
  });
});
