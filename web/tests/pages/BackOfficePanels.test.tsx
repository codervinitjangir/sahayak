import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { CataloguePanel, JobsBoardPanel, OwnersPanel, StaffPanel } from '../../src/pages/admin/BackOfficePanels';
import { adminService } from '../../src/services/admin.service';

vi.mock('../../src/services/admin.service', async (orig) => {
  const real = await orig<typeof import('../../src/services/admin.service')>();
  return {
    ...real,
    adminService: {
      listJobs: vi.fn(), reassignJob: vi.fn(), getAlerts: vi.fn(), listCatalogue: vi.fn(), setServicePrice: vi.fn(), listStaff: vi.fn(), inviteStaff: vi.fn(), revokeInvite: vi.fn(), updateStaff: vi.fn(), cancelJob: vi.fn(), listUsers: vi.fn(), setUserSuspension: vi.fn(), listAudit: vi.fn(),
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
    vi.mocked(adminService.getAlerts).mockResolvedValue({
      generated_at: '2026-11-14T12:00:00Z',
      alerts: [{ code: 'STUCK_JOBS', severity: 'critical', message: '1 job(s) have not moved for longer than expected.', count: 1, job_ids: ['abcdef12-0000'] }],
      live_jobs: 1, partners_on_duty: 2, partners_verified: 4, window_minutes: 60,
      jobs_in_window: 0, no_match_in_window: 0, no_match_rate: null,
    });
    vi.mocked(adminService.cancelJob).mockResolvedValue({ ...job, status: 'cancelled' });
  });

  it('shows operational alerts above the board, with the figures they came from', async () => {
    wrap(<JobsBoardPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/have not moved/i);
    expect(screen.getByText(/2 of 4 verified\s+partners on duty/i)).toBeInTheDocument();
    expect(screen.getByText(/too few requests/i)).toBeInTheDocument();
  });

  it('offers Reassign only while a partner holds the job, and reports what happened', async () => {
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: /reassign/i })).not.toBeInTheDocument();
    vi.mocked(adminService.listJobs).mockResolvedValue({
      items: [{ ...job, status: 'assigned', assignment_status: 'accepted', partner_name: 'Ravi' }], total: 1, limit: 50, offset: 0,
    });
    vi.mocked(adminService.reassignJob).mockResolvedValue({ ...job, status: 'no_match_found' });
    wrap(<JobsBoardPanel />);
    await user.click(await screen.findByRole('button', { name: /reassign/i }));
    await user.type(screen.getByLabelText(/reason/i), 'partner unreachable');
    await user.click(screen.getByRole('button', { name: 'Reassign job' }));
    await waitFor(() => expect(adminService.reassignJob).toHaveBeenCalledWith('j1', 'partner unreachable'));
    expect(await screen.findByText(/no other partner is available/i)).toBeInTheDocument();
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


describe('CataloguePanel', () => {
  const item = { id: 3, code: 'flat_tyre', name: 'Flat tyre', base_price: '399.00', category_name: 'Mechanical' };
  beforeEach(() => {
    vi.mocked(adminService.listCatalogue).mockResolvedValue([item]);
    vi.mocked(adminService.setServicePrice).mockResolvedValue({ ...item, base_price: '450' });
  });

  it('will not save a price without a reason, an unchanged price, or an implausible one', async () => {
    const user = userEvent.setup();
    wrap(<CataloguePanel />);
    await user.click(await screen.findByRole('button', { name: /change price of flat tyre/i }));
    const save = screen.getByRole('button', { name: 'Save price' });
    const amount = screen.getByLabelText(/base price/i);
    await user.type(screen.getByLabelText(/reason/i), 'fuel costs up');
    expect(save).toBeDisabled(); // unchanged at 399
    await user.clear(amount);
    await user.type(amount, '0');
    expect(save).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '450');
    expect(save).not.toBeDisabled();
    await user.click(save);
    await waitFor(() => expect(adminService.setServicePrice).toHaveBeenCalledWith('flat_tyre', '450', 'fuel costs up'));
  });
});


describe('StaffPanel', () => {
  const me = { id: 'a1', name: 'Dev', role: 'super_admin', phone: '+919000000001', has_login: true, is_you: true };
  const other = { id: 'a2', name: 'Ravi', role: 'ops', phone: '+919000000002', has_login: true, is_you: false };

  it('shows a new invite code once and never offers controls on your own row', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listStaff).mockResolvedValue({ staff: [me, other], invites: [], your_role: 'super_admin' });
    vi.mocked(adminService.inviteStaff).mockResolvedValue({
      id: 'i1', name: 'Asha', role: 'support', phone: '+919876543210', expires_at: new Date().toISOString(), expired: false,
      token: 'tok-shown-once-0123456789-0123456789-abcdef',
    });
    wrap(<StaffPanel />);
    expect(await screen.findByText('Ravi')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /switch off/i })).toHaveLength(1); // Ravi only, not "you"

    const create = screen.getByRole('button', { name: /create invite/i });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'Asha');
    await user.type(screen.getByLabelText(/mobile number/i), '9876543210');
    await user.click(create);
    await waitFor(() =>
      expect(adminService.inviteStaff).toHaveBeenCalledWith({ name: 'Asha', phone: '+919876543210', role: 'support' })
    );
    expect(await screen.findByTestId('invite-token')).toHaveTextContent('tok-shown-once');
  });

  it('gives a non-super admin a read-only list', async () => {
    vi.mocked(adminService.listStaff).mockResolvedValue({ staff: [me, other], invites: [], your_role: 'support' });
    wrap(<StaffPanel />);
    expect(await screen.findByText('Ravi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create invite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch off/i })).not.toBeInTheDocument();
  });
});
