import React from 'react';

import { AnalyticsDispatch, num } from '../../types/admin';
import {
  ChartCard,
  DataTable,
  HBars,
  HeroFigure,
  NotesList,
  RangeStrip,
  StackedBar,
  StatTile,
} from '../../features/admin/viz/primitives';
import { ORDINAL, SERIES, compact, dur, pct } from '../../features/admin/viz/tokens';

/**
 * Dispatch: are offers being answered, and how fast does matching run?
 *
 * The hero is acceptance rate **of answered offers**, because that is the one an
 * operator can act on — it measures whether mechanics who looked at an offer
 * took it. The other rate, of *all* offers, is published immediately beside it
 * rather than buried: offers never expire in this system, so an unanswered offer
 * sits open forever and the two rates can diverge without bound. Shipping only
 * one of them would be a choice about which way to flatter the number.
 */
export const DispatchPanel: React.FC<{ data: AnalyticsDispatch }> = ({ data }) => {
  const { offers, offers_before_acceptance: ranks, no_match: noMatch, dispatch_latency: latency } = data;

  const outcomeSegments = [
    { label: 'Accepted', value: offers.accepted, color: SERIES.one },
    { label: 'Declined', value: offers.declined, color: SERIES.two },
    { label: 'Unanswered', value: offers.unanswered, color: SERIES.three },
  ];

  // Ordered bins, so an ordered ramp: rank is a position, and the ramp's
  // light→dark carries that position. A categorical palette here would imply
  // three unrelated identities.
  const rankBars = [
    { label: 'Accepted at rank 1', value: ranks.at_rank_1, color: ORDINAL[0] },
    { label: 'At rank 2', value: ranks.at_rank_2, color: ORDINAL[1] },
    { label: 'At rank 3 or worse', value: ranks.at_rank_3_or_worse, color: ORDINAL[2] },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-[16px] border border-[#E7E0D2] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <HeroFigure
            label="Acceptance rate (of answered offers)"
            value={pct(offers.acceptance_rate_of_answered)}
            caption={`${compact(offers.accepted)} accepted of ${compact(
              offers.accepted + offers.declined
            )} answered`}
          />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-right">
            <div>
              <dt className="text-xs text-[#5B5346] font-medium">Of all offers sent</dt>
              <dd
                className="text-lg font-bold text-[#1B1712] font-['Fraunces']"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {pct(offers.acceptance_rate_of_all)}
              </dd>
              <dd className="text-[11px] text-[#9A917F]">
                {compact(offers.unanswered)} never answered
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Offers sent</dt>
              <dd
                className="text-lg font-semibold text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compact(offers.total)}
              </dd>
              <dd className="text-[11px] text-slate-400">
                to {compact(offers.partners_offered)} partners
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <NotesList notes={data.notes} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Offer outcomes"
          subtitle="Classified by accepted_at / responded_at, never by assignment status — that column is overwritten when a job ends."
          empty={offers.total === 0}
          table={
            <DataTable
              columns={['Outcome', 'Offers', 'Share']}
              rows={outcomeSegments.map((s) => [
                s.label,
                s.value.toLocaleString('en-IN'),
                pct(offers.total > 0 ? s.value / offers.total : null),
              ])}
            />
          }
        >
          <StackedBar segments={outcomeSegments} total={offers.total} />
          <p className="mt-3 text-xs text-slate-500">
            {compact(offers.jobs_offered)} jobs produced these offers.
          </p>
        </ChartCard>

        <ChartCard
          title="How far down the ranking acceptances came from"
          subtitle="First-choice acceptances mean the ranking is picking well."
          empty={ranks.accepted_offers === 0}
          emptyLabel="No offer was accepted in this window."
          table={
            <DataTable
              columns={['Rank', 'Acceptances']}
              rows={[
                ...rankBars.map((r) => [r.label, r.value.toLocaleString('en-IN')]),
                ['Mean rank', num(ranks.mean_rank)?.toFixed(2) ?? '—'],
                ['Worst rank seen', ranks.worst_rank?.toLocaleString('en-IN') ?? '—'],
              ]}
            />
          }
        >
          <HBars data={rankBars} color={ORDINAL[1]} />
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
            <div>
              <dt className="text-xs text-slate-500">Mean rank</dt>
              <dd
                className="text-sm font-semibold text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {num(ranks.mean_rank)?.toFixed(2) ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Worst rank seen</dt>
              <dd
                className="text-sm font-semibold text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {ranks.worst_rank ?? '—'}
              </dd>
            </div>
          </dl>
        </ChartCard>

        <ChartCard
          title="Jobs that found nobody"
          subtitle="An outage is not a supply problem — it leaves both sides of the rate, with the inclusive figure published beside it."
          empty={noMatch.jobs_in_window === 0}
          table={
            <DataTable
              columns={['Measure', 'Value']}
              rows={[
                ['Genuinely no partner', noMatch.genuine.toLocaleString('en-IN')],
                ['Dispatch unavailable (outage)', noMatch.dispatch_unavailable.toLocaleString('en-IN')],
                ['No-match total', noMatch.total.toLocaleString('en-IN')],
                ['Jobs in window', noMatch.jobs_in_window.toLocaleString('en-IN')],
                ['Rate (outages excluded)', pct(noMatch.rate)],
                ['Rate (outages included)', pct(noMatch.rate_including_outages)],
              ]}
            />
          }
        >
          <StackedBar
            segments={[
              { label: 'Genuinely no partner', value: noMatch.genuine, color: SERIES.two },
              {
                label: 'Dispatch unavailable',
                value: noMatch.dispatch_unavailable,
                color: SERIES.three,
              },
              {
                label: 'Matched or still matching',
                value: Math.max(noMatch.jobs_in_window - noMatch.total, 0),
                color: SERIES.one,
              },
            ]}
            total={noMatch.jobs_in_window}
          />
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
            <div>
              <p className="text-xs text-slate-500">No-match rate</p>
              <p
                className="text-sm font-semibold text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {pct(noMatch.rate)}
              </p>
              <p className="text-[11px] text-slate-400">outage jobs excluded</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Including outages</p>
              <p
                className="text-sm font-semibold text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {pct(noMatch.rate_including_outages)}
              </p>
              <p className="text-[11px] text-slate-400">
                {compact(noMatch.dispatch_unavailable)} outage jobs
              </p>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Dispatch latency"
          subtitle={`Request to first offer, across ${compact(latency.count)} dispatches.`}
          empty={latency.count === 0}
          table={
            <DataTable
              columns={['Measure', latency.unit]}
              rows={[
                ['Dispatches measured', compact(latency.count)],
                ['Minimum', dur(num(latency.min), latency.unit)],
                ['Median (p50)', dur(num(latency.p50), latency.unit)],
                ['p95', dur(num(latency.p95), latency.unit)],
                ['Maximum', dur(num(latency.max), latency.unit)],
                ['Mean', dur(num(latency.mean), latency.unit)],
              ]}
            />
          }
        >
          <RangeStrip
            min={num(latency.min)}
            p50={num(latency.p50)}
            p95={num(latency.p95)}
            max={num(latency.max)}
            mean={num(latency.mean)}
            unit={latency.unit}
            color={SERIES.one}
          />
          <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-3">
            {[
              ['Median', dur(num(latency.p50), latency.unit)],
              ['p95', dur(num(latency.p95), latency.unit)],
              ['Mean', dur(num(latency.mean), latency.unit)],
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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Jobs that produced offers" value={compact(offers.jobs_offered)} />
        <StatTile label="Distinct partners offered to" value={compact(offers.partners_offered)} />
        <StatTile
          label="Offers per offered job"
          value={
            offers.jobs_offered > 0 ? (offers.total / offers.jobs_offered).toFixed(2) : '—'
          }
          hint="Higher means more partners tried per job"
        />
      </div>
    </div>
  );
};
