import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from '../../src/app/AuthProvider';

import { AdminConsole } from '../../src/pages/admin/AdminConsole';
import { adminService } from '../../src/services/admin.service';
import { ApiError } from '../../src/services/api';
import type {
  AnalyticsDispatch,
  AnalyticsMatching,
  AnalyticsOverview,
} from '../../src/types/admin';

/**
 * The admin console's three panels.
 *
 * These assert the things I would be looking for if I could open the page: that
 * each panel renders at all against a realistic payload, that the backend's
 * `notes[]` reach the screen **verbatim** (they are the whole point of ADR-021 —
 * a number ships with its caveat attached), that every chart's table twin is
 * reachable, and that a 403 says something a reader can act on rather than
 * offering a retry that cannot work.
 *
 * What they do **not** cover: visual layout. Label collisions, overflow and
 * geometry need a rendered page, and jsdom has no layout engine — it reports
 * every width as zero. That gap is real and recorded in TASKS.md.
 */
vi.mock('../../src/services/admin.service');

vi.mock('../../src/services/supabase', () => ({
  IS_SUPABASE_CONFIGURED: false,
  getSupabase: () => {
    throw new Error('not configured in this test');
  },
  signOut: async () => undefined,
  sendPhoneOtp: async () => ({ ok: true }),
  verifyPhoneOtp: async () => ({ ok: true, accessToken: 't' }),
  toE164: (d: string, l: string) => `${d}${l}`,
}));

const OVERVIEW: AnalyticsOverview = {
  window: {
    requested_from: '2026-10-01T00:00:00Z',
    requested_to: null,
    first_job_at: '2026-10-02T09:00:00Z',
    last_job_at: '2026-10-08T17:30:00Z',
  },
  jobs: {
    total: 42,
    requested: 2,
    matching: 1,
    assigned: 3,
    partner_en_route: 1,
    in_progress: 2,
    completed: 28,
    cancelled: 4,
    no_match_found: 1,
  },
  conversion: { completed: 28, total: 42, still_open: 9, rate: 0.6667 },
  partners: {
    partners_total: 12,
    verified: 9,
    available_now: 5,
    dispatchable_now: 4,
    busy_now: 2,
    live_assignments: 2,
    rated: 6,
    ratings_total: 31,
    mean_rating: '4.35',
  },
  work_started: {
    count: 30,
    mean: '18.4',
    min: '4.2',
    p50: '15.1',
    p95: '41.8',
    max: '63.0',
    unit: 'minutes',
  },
  eta_accuracy: null,
  notes: [
    { code: 'ETA_ACCURACY_NOT_COMPUTABLE', detail: 'No arrival estimate is ever recorded.' },
    { code: 'WORK_STARTED_IS_NOT_ARRIVAL', detail: 'in_progress means work began, not arrival.' },
  ],
};

const DISPATCH: AnalyticsDispatch = {
  window: OVERVIEW.window,
  dispatch_latency: {
    count: 40,
    mean: '0.9',
    min: '0.4',
    p50: '0.8',
    p95: '1.6',
    max: '2.2',
    unit: 'seconds',
  },
  offers: {
    total: 61,
    accepted: 33,
    declined: 12,
    timed_out: 0,
    unanswered: 16,
    jobs_offered: 40,
    partners_offered: 9,
    acceptance_rate_of_answered: 0.7333,
    acceptance_rate_of_all: 0.541,
  },
  offers_before_acceptance: {
    accepted_offers: 33,
    mean_rank: '1.36',
    at_rank_1: 24,
    at_rank_2: 6,
    at_rank_3_or_worse: 3,
    worst_rank: 4,
  },
  no_match: {
    total: 3,
    genuine: 2,
    dispatch_unavailable: 1,
    jobs_in_window: 42,
    rate: 0.0488,
    rate_including_outages: 0.0714,
  },
  notes: [
    { code: 'UNANSWERED_OFFERS_HAVE_NO_EXPIRY', detail: 'Offers never expire, so these stay open.' },
    { code: 'OUTAGE_JOBS_EXCLUDED_FROM_NO_MATCH_RATE', detail: 'One outage job left the rate.' },
  ],
};

const MATCHING: AnalyticsMatching = {
  window: OVERVIEW.window,
  divergence: { first_offers: 40, diverged: 28, agreed_with_nearest: 12, rate: 0.7 },
  weighted_diverged: {
    offers: 28,
    answered: 22,
    accepted: 17,
    acceptance_rate: 0.7727,
    mean_matching_score: '0.8553',
    mean_distance_score: '0.7883',
    mean_load_score: '0.9100',
    mean_skill_score: '1.0000',
    mean_rating_score: '0.7000',
  },
  also_nearest: {
    offers: 12,
    answered: 10,
    accepted: 8,
    acceptance_rate: 0.8,
    mean_matching_score: '0.8823',
    mean_distance_score: '0.8823',
    mean_load_score: '0.5000',
    mean_skill_score: '1.0000',
    mean_rating_score: '0.7000',
  },
  attribution: {
    diverged_offers: 28,
    deltas: {
      distance_score: '-0.0940',
      load_score: '0.4100',
      skill_score: null,
      rating_score: null,
    },
    stddev: { distance_score: '0.05', load_score: '0.11', skill_score: '0', rating_score: '0' },
    eligible_components: ['load_score'],
    constant_components: ['skill_score', 'rating_score'],
    driver: 'load_score',
  },
  notes: [
    { code: 'FIRST_OFFERS_ONLY', detail: 'Only the first offer per job is comparable.' },
    { code: 'CONSTANT_COMPONENTS_CANNOT_ATTRIBUTE', detail: 'Two components never varied.' },
  ],
};

function renderConsole(tab = 'overview') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/${tab}`]}>
        <Routes>
            <Route path="/admin/:tab" element={<AdminConsole />} />
            <Route path="/owner" element={<div>Owner Home</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

describe('AdminConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(adminService.getOverview).mockResolvedValue(OVERVIEW);
    vi.mocked(adminService.getDispatch).mockResolvedValue(DISPATCH);
    vi.mocked(adminService.getMatching).mockResolvedValue(MATCHING);
  });

  it('leads the overview with the completion rate and its denominator', async () => {
    renderConsole('overview');
    expect(await screen.findByText('66.7%')).toBeInTheDocument();
    // The rate is never shown without what it is a rate of.
    expect(screen.getByText(/28 of 42 jobs completed/)).toBeInTheDocument();
  });

  it('renders the funnel in pipeline order, not sorted by size', async () => {
    renderConsole('overview');
    await screen.findByText('Jobs by status');
    const labels = screen.getAllByTitle(/^(Requested|Matching|Assigned|Completed)$/).map((n) => n.textContent);
    // Completed (28) is the largest but must come after the earlier stages:
    // sorting by magnitude would destroy the only thing the sequence says.
    expect(labels.indexOf('Requested')).toBeLessThan(labels.indexOf('Completed'));
  });

  it('renders the backend notes verbatim, code and detail', async () => {
    renderConsole('overview');
    expect(await screen.findByText('ETA_ACCURACY_NOT_COMPUTABLE')).toBeInTheDocument();
    expect(screen.getByText(/No arrival estimate is ever recorded\./)).toBeInTheDocument();
    expect(screen.getByText(/How to read these figures \(2\)/)).toBeInTheDocument();
  });

  it('shows an em dash for eta_accuracy rather than a zero', async () => {
    // Plotting "not computable" as 0 would be the chart telling a lie.
    renderConsole('overview');
    await screen.findByText('ETA accuracy');
    expect(screen.getByText(/Not computable: no arrival estimate/)).toBeInTheDocument();
  });

  it('offers a table twin for every chart', async () => {
    renderConsole('overview');
    await screen.findByText('Jobs by status');
    const toggles = screen.getAllByRole('button', { name: /^Table$/ });
    expect(toggles.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(toggles[0]);
    // The same values, now reachable without hovering anything.
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Chart$/ })).toBeInTheDocument();
  });

  it('publishes both acceptance rates on the dispatch tab, not just the flattering one', async () => {
    renderConsole('dispatch');
    // Of answered offers — the hero.
    expect(await screen.findByText('73.3%')).toBeInTheDocument();
    // Of all offers sent, including the 16 nobody answered.
    expect(screen.getByText('54.1%')).toBeInTheDocument();
    expect(screen.getByText(/16 never answered/)).toBeInTheDocument();
  });

  it('publishes the no-match rate both with and without outages', async () => {
    renderConsole('dispatch');
    await screen.findByText('Jobs that found nobody');
    expect(screen.getByText('4.9%')).toBeInTheDocument();   // outages excluded
    expect(screen.getByText('7.1%')).toBeInTheDocument();   // outages included
  });

  it('names the driver on the matching tab and marks the constant components', async () => {
    renderConsole('matching');
    expect(await screen.findByText('70.0%')).toBeInTheDocument();
    // 'Load' appears as a chart category and as a delta row; the driver
    // readout is the one with the heading above it.
    expect(screen.getByText('Driver of the divergence')).toBeInTheDocument();
    expect(screen.getAllByText('Load').length).toBeGreaterThan(0);
    // Constants are labelled, not recoloured — a third hue would make
    // "not applicable" look like a category.
    expect(screen.getAllByTitle(/Constant across this window/).length).toBe(2);
    expect(screen.getByText(/were constant across this window/)).toBeInTheDocument();
  });

  it('calls out a 0% divergence as a finding rather than leaving it blank', async () => {
    vi.mocked(adminService.getMatching).mockResolvedValue({
      ...MATCHING,
      divergence: { first_offers: 40, diverged: 0, agreed_with_nearest: 40, rate: 0 },
    });
    renderConsole('matching');
    expect(
      await screen.findByText(/A rate of exactly 0% is the finding, not a blank/)
    ).toBeInTheDocument();
  });

  it('scopes every panel from one filter row', async () => {
    renderConsole('overview');
    await screen.findByText('66.7%');
    // Default window is 7 days, so the service saw a `from`.
    expect(vi.mocked(adminService.getOverview).mock.calls[0][0]).toHaveProperty('from');

    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() =>
      // All time sends no bounds at all.
      expect(vi.mocked(adminService.getOverview)).toHaveBeenCalledWith({})
    );
  });

  it('explains a 403 instead of offering a retry that cannot work', async () => {
    vi.mocked(adminService.getOverview).mockRejectedValue(
      new ApiError(403, { code: 'FORBIDDEN', message: 'Admins only.' }, 'req-1')
    );
    renderConsole('overview');
    expect(await screen.findByText(/This account is not an administrator/)).toBeInTheDocument();
    expect(screen.getByText(/granted directly in the database/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('surfaces the request id on an unexpected failure, for reporting it', async () => {
    vi.mocked(adminService.getOverview).mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'Could not read analytics' }, 'req-42')
    );
    renderConsole('overview');
    // Longer timeout on purpose: unlike a 403, a 500 is retried once, so the
    // message is one backoff interval away. That delay is the intended behaviour.
    expect(
      await screen.findByText(/Could not load the report/, {}, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByText(/req-42/)).toBeInTheDocument();
  });
});
