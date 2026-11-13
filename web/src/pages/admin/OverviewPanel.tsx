import React from 'react';

import { AnalyticsOverview, num } from '../../types/admin';
import {
  ChartCard,
  DataTable,
  HBars,
  HeroFigure,
  NotesList,
  RangeStrip,
  StatTile,
} from '../../features/admin/viz/primitives';
import { SERIES, compact, dur, pct } from '../../features/admin/viz/tokens';

/**
 * Overview: did jobs get done, and is there supply to do them?
 *
 * The hero figure is the completion rate — one per screen, and this is the one
 * number that answers "is the product working". Everything else on the panel
 * explains or qualifies it.
 */
export const OverviewPanel: React.FC<{ data: AnalyticsOverview }> = ({ data }) => {
  const { jobs, conversion, partners, work_started: work } = data;

  // Pipeline order, not magnitude order. These are stages, and sorting them by
  // count would destroy the only thing their sequence tells you.
  const funnel = [
    { label: 'Requested', value: jobs.requested },
    { label: 'Matching', value: jobs.matching },
    { label: 'Assigned', value: jobs.assigned },
    { label: 'Partner en route', value: jobs.partner_en_route },
    { label: 'In progress', value: jobs.in_progress },
    { label: 'Completed', value: jobs.completed },
    { label: 'Cancelled', value: jobs.cancelled },
    { label: 'No match found', value: jobs.no_match_found },
  ];

  return (
    <div className="space-y-5">
      {/* The hero and its immediate context, in one card so the number is read
          with its denominator rather than on its own. */}
      <section className="rounded-[16px] border border-[#EEF2F6] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <HeroFigure
            label="Completion rate"
            value={pct(conversion.rate)}
            caption={`${compact(conversion.completed)} of ${compact(
              conversion.total
            )} jobs completed · ${compact(conversion.still_open)} still open`}
          />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-right sm:grid-cols-3">
            {[
              ['Jobs in window', compact(jobs.total)],
              ['Cancelled', compact(jobs.cancelled)],
              ['No match found', compact(jobs.no_match_found)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-[#475569] font-medium">{label}</dt>
                <dd
                  className="text-lg font-bold text-[#0F172A]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <NotesList notes={data.notes} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Jobs by status"
          subtitle="Pipeline order, not sorted by size — the sequence is the information."
          empty={jobs.total === 0}
          table={
            <DataTable
              columns={['Status', 'Jobs']}
              rows={funnel.map((f) => [f.label, f.value.toLocaleString('en-IN')])}
            />
          }
        >
          <HBars data={funnel} color={SERIES.one} />
        </ChartCard>

        <ChartCard
          title="Time from request to work starting"
          subtitle={`${compact(work.count)} jobs that ever reached in_progress, including finished ones.`}
          empty={work.count === 0}
          emptyLabel="No job reached in_progress in this window."
          table={
            <DataTable
              columns={['Measure', work.unit]}
              rows={[
                ['Jobs measured', compact(work.count)],
                ['Minimum', dur(num(work.min), work.unit)],
                ['Median (p50)', dur(num(work.p50), work.unit)],
                ['p95', dur(num(work.p95), work.unit)],
                ['Maximum', dur(num(work.max), work.unit)],
                ['Mean', dur(num(work.mean), work.unit)],
              ]}
            />
          }
        >
          <RangeStrip
            min={num(work.min)}
            p50={num(work.p50)}
            p95={num(work.p95)}
            max={num(work.max)}
            mean={num(work.mean)}
            unit={work.unit}
            color={SERIES.one}
          />
          <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-3">
            {[
              ['Median', dur(num(work.p50), work.unit)],
              ['p95', dur(num(work.p95), work.unit)],
              ['Mean', dur(num(work.mean), work.unit)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd
                  className="text-sm font-semibold text-slate-900"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </ChartCard>
      </div>

      {/* Supply is a set of independent counts, not a distribution — seven
          stat tiles, not seven bars competing for a shared axis they do not
          share. `dispatchable_now` is the one that matters: a partner who is
          verified and on shift but has no live location cannot be offered
          anything. */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Partner supply, right now</h3>
        <p className="mb-3 text-xs text-slate-500">
          A snapshot of the current roster — not scoped to the window above, and never was.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Partners registered" value={compact(partners.partners_total)} />
          <StatTile
            label="Verified"
            value={compact(partners.verified)}
            hint="Eligible for dispatch at all"
          />
          <StatTile
            label="Dispatchable now"
            value={compact(partners.dispatchable_now)}
            hint="Verified, on shift, and with a live location"
          />
          <StatTile
            label="Busy now"
            value={compact(partners.busy_now)}
            hint={`${compact(partners.live_assignments)} live assignments`}
          />
          <StatTile label="Available (on shift)" value={compact(partners.available_now)} />
          <StatTile
            label="Rated partners"
            value={compact(partners.rated)}
            hint={`${compact(partners.ratings_total)} ratings total`}
          />
          <StatTile
            label="Mean rating"
            value={
              num(partners.mean_rating) === null
                ? '—'
                : num(partners.mean_rating)!.toFixed(2)
            }
            hint="Across rated partners only"
          />
          <StatTile
            label="ETA accuracy"
            value="—"
            hint="Not computable: no arrival estimate is ever written"
          />
        </div>
      </section>
    </div>
  );
};
