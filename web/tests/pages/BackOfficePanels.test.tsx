import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { JobsBoardPanel, OwnersPanel } from '../../src/pages/admin/BackOfficePanels';
import { adminService } from '../../src/services/admin.service';

vi.mock('../../src/services/admin.service', async (orig) => {
  const real = await orig<typeof import('../../src/services/admin.service')>();
  return {
    ...real,
    adminService: {
      listJobs: vi.fn(), cancelJob: vi.fn(), listUsers: vi.fn(), setUserSuspension: vi.fn(), listAudit: vi.fn(),
    },
  };
});

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const job = {
  id: 'j1', status: 'no_match_found', service_name: 'Battery Jumpstart', vehicle_number: 'KA01AB1234',
  pickup_address_text: 'MG Road', owner_name: 'Asha', owner_phone: '+919000000001', partner_name: null,
  partner_phone: null, assignment_status: null, requested_at: new Date().toISOString(),
};

describe('JobsBoardPanel', () => {
  beforeEach(() => {
    vi.mocked(adminService.listJobs).mockResolvedValue({ items: [job], total: 1, limit: 50, offset: 0 });
    vi.mocked(adminService.cancelJob).mockResolvedValue({ ...job, status: 'cancelled' });
  });

  it('lists a stranded owner with a call link', async () => {
    wrap(<JobsBoardPanel />);
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\+919000000001/ })).toHaveAttribute('href', 'tel:+919000000001');
  });

  it('will not cancel without a reason, then sends it', async () => {
    const user = userEvent.setup();
    wrap(<JobsBoardPanel />);
    await user.click(await screen.findByRole('button', { name: /cancel/i }));
    const confirm = screen.getByRole('button', { name: 'Cancel job' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/reason/i), 'duplicate request');
    await user.click(confirm);
    await waitFor(() => expect(adminService.cancelJob).toHaveBeenCalledWith('j1', 'duplicate request'));
  });
});

describe('OwnersPanel', () => {
  it('reinstates a suspended owner in one click', async () => {
    vi.mocked(adminService.listUsers).mockResolvedValue({
      items: [{ id: 'u1', name: 'Ravi', phone: '+919000000002', created_at: '2026-11-01T00:00:00Z', job_count: 3,
        has_login: true, suspended_at: '2026-11-10T00:00:00Z', suspension_reason: 'abuse' }],
      total: 1, limit: 50, offset: 0,
    });
    vi.mocked(adminService.setUserSuspension).mockResolvedValue({
      id: 'u1', name: 'Ravi', phone: '+919000000002', created_at: '2026-11-01T00:00:00Z', job_count: 3, has_login: true,
    });
    const user = userEvent.setup();
    wrap(<OwnersPanel />);
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reinstate/i }));
    await waitFor(() => expect(adminService.setUserSuspension).toHaveBeenCalledWith('u1', false, undefined));
  });
});
