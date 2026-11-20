import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OwnerSafeguards, PartnerPriceRequest } from '../../src/components/JobSafeguards';
import { DisputesPanel } from '../../src/pages/admin/DisputesPanel';
import { safeguardsService, type JobSafeguards } from '../../src/services/safeguards.service';
import { adminService } from '../../src/services/admin.service';
import { ApiError } from '../../src/services/api';

vi.mock('../../src/services/admin.service');
vi.mock('../../src/services/safeguards.service', async (orig) => {
  const real = await orig<typeof import('../../src/services/safeguards.service')>();
  return { ...real, safeguardsService: { get: vi.fn(), decidePrice: vi.fn(), proposePrice: vi.fn(), requestNewPartner: vi.fn(), photoUrl: vi.fn() } };
});

const base: JobSafeguards = {
  job_id: 'job-1', status: 'in_progress', price_estimate: '500.00', price_allowed_max: '550.00',
  price_ceiling: '5000.00', pending_revision: null, revisions: [], photos_required: false, photos: [],
  new_partner_available_at: null, can_request_new_partner: false,
};

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe('OwnerSafeguards (ADR-039, ADR-041)', () => {
  it('shows a pending price change with the estimate and approves it', async () => {
    vi.mocked(safeguardsService.get).mockResolvedValue({
      ...base,
      pending_revision: { id: 'rev-1', proposed_amount: '900.00', reason: 'battery is dead', status: 'pending', created_at: '2026-11-21T10:00:00Z' },
    });
    vi.mocked(safeguardsService.decidePrice).mockResolvedValue({} as never);
    wrap(<OwnerSafeguards jobId="job-1" />);
    expect(await screen.findByText(/asks for a higher price/i)).toBeTruthy();
    expect(screen.getByText('₹900')).toBeTruthy();
    expect(screen.getByText(/battery is dead/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(safeguardsService.decidePrice).toHaveBeenCalledWith('job-1', 'rev-1', true));
  });

  it('offers "Find another partner" only when the server says it may', async () => {
    vi.mocked(safeguardsService.get).mockResolvedValue({ ...base, status: 'assigned', new_partner_available_at: new Date(Date.now() + 9 * 60000).toISOString() });
    wrap(<OwnerSafeguards jobId="job-1" />);
    expect(await screen.findByText(/Not here in 9 min/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /find another partner/i })).toBeNull();
  });

  it('always carries the impersonation warning', async () => {
    vi.mocked(safeguardsService.get).mockResolvedValue(base);
    wrap(<OwnerSafeguards jobId="job-1" />);
    expect(await screen.findByText(/Only the partner shown here is from Sahayak/)).toBeTruthy();
  });
});

describe('PartnerPriceRequest (ADR-039)', () => {
  it('states the free limit and explains an unneeded request', async () => {
    vi.mocked(safeguardsService.get).mockResolvedValue(base);
    vi.mocked(safeguardsService.proposePrice).mockRejectedValue(new ApiError(400, { code: 'PRICE_REVISION_NOT_NEEDED', message: 'x' }));
    wrap(<PartnerPriceRequest jobId="job-1" />);
    expect(await screen.findByText(/up to ₹550 without asking/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/New total/i), { target: { value: '540' } });
    fireEvent.change(screen.getByPlaceholderText(/Why\?/), { target: { value: 'rounding up' } });
    fireEvent.click(screen.getByRole('button', { name: /ask owner to approve/i }));
    expect(await screen.findByText(/within what you can charge already/)).toBeTruthy();
  });
});

describe('DisputesPanel (ADR-027, ADR-043)', () => {
  it('lists open reports and labels off-app payment', async () => {
    vi.mocked(adminService.listDisputes).mockResolvedValue({
      total: 1,
      items: [{ id: 'd-1', job_id: 'abcdef12-0000', reason: 'off_app_payment', description: 'asked for cash', status: 'open', created_at: '2026-11-21T10:00:00Z' }],
    });
    wrap(<DisputesPanel />);
    expect(await screen.findByText('Asked to pay outside the app')).toBeTruthy();
    expect(screen.getByText(/asked for cash/)).toBeTruthy();
    expect(adminService.listDisputes).toHaveBeenCalledWith('open', 0);
  });
});
