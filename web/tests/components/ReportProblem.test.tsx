import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ReportProblem } from '../../src/components/ReportProblem';
import { disputesService } from '../../src/services/disputes.service';
import { PartnerDataExport } from '../../src/pages/partner/components/DeletePartnerAccount';
import { partnerService } from '../../src/services/partner.service';
import { PrivacyPage, PRIVACY_ITEMS } from '../../src/pages/legal/LegalPage';
import { ApiError } from '../../src/services/api';

vi.mock('../../src/app/AuthProvider', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('../../src/services/partner.service', () => ({ partnerService: { deleteMe: vi.fn(), exportMe: vi.fn() } }));
vi.mock('../../src/services/disputes.service', async (orig) => {
  const real = await orig<typeof import('../../src/services/disputes.service')>();
  return { ...real, disputesService: { open: vi.fn(), list: vi.fn() } };
});

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        {ui}
      </QueryClientProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('ReportProblem on web (ADR-043)', () => {
  it('sends the chosen reason and the text', async () => {
    vi.mocked(disputesService.list).mockResolvedValue([]);
    vi.mocked(disputesService.open).mockResolvedValue({} as never);
    wrap(<ReportProblem jobId="job-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    fireEvent.click(screen.getByLabelText('I was overcharged'));
    fireEvent.change(screen.getByLabelText(/tell us more/i), { target: { value: 'asked 900 for 500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(disputesService.open).toHaveBeenCalledWith('job-1', 'overcharged', 'asked 900 for 500'));
  });

  it('a cancelled job offers only the reasons that fit it', async () => {
    vi.mocked(disputesService.list).mockResolvedValue([]);
    wrap(<ReportProblem jobId="job-2" cancelled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    expect(screen.getByLabelText('Asked to pay outside the app')).toBeTruthy();
    expect(screen.queryByLabelText('I was overcharged')).toBeNull();
    expect(screen.queryByLabelText('The job was not done')).toBeNull();
  });

  it('an open report shows its state and hides the button', async () => {
    vi.mocked(disputesService.list).mockResolvedValue([
      { id: 'd1', job_id: 'job-3', reason: 'damage', status: 'open', created_at: '2026-11-21T10:00:00Z' },
    ]);
    wrap(<ReportProblem jobId="job-3" />);
    expect(await screen.findByText(/our team is looking at it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
  });

  it('explains a refusal from the server', async () => {
    vi.mocked(disputesService.list).mockResolvedValue([]);
    vi.mocked(disputesService.open).mockRejectedValue(new ApiError(409, { code: 'JOB_NOT_DISPUTABLE', message: 'no' }));
    wrap(<ReportProblem jobId="job-4" cancelled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    fireEvent.click(screen.getByLabelText('Something else'));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText(/cannot be reported/i)).toBeTruthy();
  });
});

describe('partner data export on web', () => {
  it('downloads the JSON from the export endpoint', async () => {
    vi.mocked(partnerService.exportMe).mockResolvedValue({ profile: { name: 'Ravi' } });
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    wrap(<PartnerDataExport />);
    fireEvent.click(screen.getByRole('button', { name: /download my data/i }));
    await waitFor(() => expect(createUrl).toHaveBeenCalled());
    expect(partnerService.exportMe).toHaveBeenCalled();
  });
});

describe('itemised privacy notice (DPDP rule 3)', () => {
  it('lists every item with a purpose and a retention', () => {
    wrap(<PrivacyPage />);
    for (const row of PRIVACY_ITEMS) {
      expect(screen.getByText(row.item)).toBeTruthy();
      expect(row.why.length).toBeGreaterThan(5);
      expect(row.kept.length).toBeGreaterThan(5);
    }
    expect(screen.getByText(/Data Protection Board of India/)).toBeTruthy();
  });
});
