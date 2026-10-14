import React from 'react';

import { AnalyticsMatching, StrategyArm, num } from '../../types/admin';
import {
  ChartCard,
  DataTable,
  DivergingBars,
  GroupedBars,
  HeroFigure,
  NotesList,
  StackedBar,
  StatTile,
} from '../../features/admin/viz/primitives';
import { DIVERGING, SERIES, compact, humanise, pct } from '../../features/admin/viz/tokens';

/** The five scoring components, in the order ADR-009 weights them. */
const COMPONENTS = [
  'distance_score',
  'load_score',
  'skill_score',
  'rating_score',
] as const;

function armValues(arm: StrategyArm): (number | null)[] {
  return [
    num(arm.mean_distance_score),
    num(arm.mean_load_score),
    num(arm.mean_skill_score),
    num(arm.mean_rating_score),
  ];
}

/**
 * Matching: does the weighted engine actually pick differently from "nearest",
 * and when it does, which component made it?
 *
 * This is the panel the project is defended on. The hero is the divergence rate,
 * because if it were zero the weighted engine would not be degraded — it would
 * be *identical* to the naive baseline it exists to beat, which is exactly what
 * the rating-pipeline bug caused before 2026-09-29 (0.0% blind, 70.0% with real
 * ratings).
 */
export const MatchingPanel: React.FC<{ data: AnalyticsMatching }> = ({ data }) => {
  const { divergence, weighted_diverged: weighted, also_nearest: nearest, attribution } = data;

  const deltaRows = COMPONENTS.map((key) => ({
    label: humanise(key),
    value: num(attribution.deltas[key]),
    muted: attribution.constant_components.includes(key),
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-[16px] border border-[#E7E0D2] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <HeroFigure
            label="Divergence from pure-nearest"
            value={pct(divergence.rate)}
            caption={`${compact(divergence.diverged)} of ${compact(
              divergence.first_offers
            )} first offers went to someone who was not the closest`}
          />
          <div className="text-right">
            <p className="text-xs text-[#5B5346] font-medium">Driver of the divergence</p>
            <p className="text-lg font-bold text-[#1B1712] font-['Fraunces']">
              {attribution.driver ? humanise(attribution.driver) : '—'}
            </p>
            <p className="max-w-[18rem] text-[11px] text-slate-400">
              {attribution.driver
                ? 'Largest mean difference among components that actually varied.'
                : 'No component varied enough to attribute.'}
            </p>
          </div>
        </div>
        {divergence.rate === 0 && divergence.first_offers > 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <strong>A rate of exactly 0% is the finding, not a blank.</strong> It means the
            weighted engine chose the nearest partner every single time — so on this window it is
            not merely similar to the naive baseline, it is indistinguishable from it.
          </p>
        )}
      </section>

      <NotesList notes={data.notes} />

      <ChartCard
        title="Mean component scores: where the weighted engine diverged vs where it agreed"
        subtitle="One shared 0–1 scale. Both arms are mean scores, so the comparison is a length comparison."
        empty={divergence.first_offers === 0}
        emptyLabel="No first offers in this window, so there is nothing to compare."
        table={
          <DataTable
            columns={['Component', 'Diverged', 'Agreed with nearest', 'Difference']}
            rows={COMPONENTS.map((key, i) => [
              humanise(key),
              armValues(weighted)[i]?.toFixed(4) ?? '—',
              armValues(nearest)[i]?.toFixed(4) ?? '—',
              num(attribution.deltas[key])?.toFixed(4) ?? '—',
            ])}
          />
        }
      >
        <GroupedBars
          categories={COMPONENTS.map(humanise)}
          series={[
            { label: 'Diverged from nearest', color: SERIES.one, values: armValues(weighted) },
            { label: 'Agreed with nearest', color: SERIES.two, values: armValues(nearest) },
          ]}
          max={1}
        />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Component differences between the two groups"
          subtitle="Group means, not a counterfactual — this does not say what would have happened."
          empty={attribution.diverged_offers === 0}
          emptyLabel="Nothing diverged, so there is no difference to attribute."
          table={
            <DataTable
              columns={['Component', 'Difference', 'Std. dev.', 'Status']}
              rows={COMPONENTS.map((key) => [
                humanise(key),
                num(attribution.deltas[key])?.toFixed(4) ?? '—',
                num(attribution.stddev[key])?.toFixed(4) ?? '—',
                attribution.constant_components.includes(key)
                  ? 'constant — excluded'
                  : attribution.driver === key
                    ? 'driver'
                    : 'eligible',
              ])}
            />
          }
        >
          <DivergingBars
            rows={deltaRows}
            positive={DIVERGING.positive}
            negative={DIVERGING.negative}
          />
          {attribution.constant_components.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              <strong>{attribution.constant_components.map(humanise).join(', ')}</strong>{' '}
              {attribution.constant_components.length === 1 ? 'was' : 'were'} constant across this
              window. A component that never varied cannot have changed a decision, so it is
              excluded from the driver rather than reported as a weak one.
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Did the two groups behave differently?"
          subtitle="Acceptance rate per group. A diverged offer going to a further partner is only worth it if they still accept."
          empty={divergence.first_offers === 0}
          table={
            <DataTable
              columns={['Group', 'Offers', 'Answered', 'Accepted', 'Acceptance rate']}
              rows={[
                [
                  'Diverged',
                  weighted.offers.toLocaleString('en-IN'),
                  weighted.answered.toLocaleString('en-IN'),
                  weighted.accepted.toLocaleString('en-IN'),
                  pct(weighted.acceptance_rate),
                ],
                [
                  'Agreed with nearest',
                  nearest.offers.toLocaleString('en-IN'),
                  nearest.answered.toLocaleString('en-IN'),
                  nearest.accepted.toLocaleString('en-IN'),
                  pct(nearest.acceptance_rate),
                ],
              ]}
            />
          }
        >
          <StackedBar
            segments={[
              { label: 'Diverged', value: divergence.diverged, color: SERIES.one },
              {
                label: 'Agreed with nearest',
                value: divergence.agreed_with_nearest,
                color: SERIES.two,
              },
            ]}
            total={divergence.first_offers}
          />
          <GroupedBars
            categories={['Acceptance rate']}
            series={[
              {
                label: 'Diverged',
                color: SERIES.one,
                values: [weighted.acceptance_rate ?? null],
              },
              {
                label: 'Agreed with nearest',
                color: SERIES.two,
                values: [nearest.acceptance_rate ?? null],
              },
            ]}
            max={1}
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />
        </ChartCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="First offers assessed"
          value={compact(divergence.first_offers)}
          hint="Only the first offer per job is comparable"
        />
        <StatTile label="Diverged" value={compact(divergence.diverged)} />
        <StatTile label="Agreed with nearest" value={compact(divergence.agreed_with_nearest)} />
        <StatTile
          label="Components that varied"
          value={
            attribution.eligible_components.length > 0
              ? attribution.eligible_components.map(humanise).join(', ')
              : 'none'
          }
          hint={`${attribution.constant_components.length} constant`}
        />
      </div>
    </div>
  );
};
