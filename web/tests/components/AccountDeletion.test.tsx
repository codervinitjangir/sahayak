import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AccountDeletionPage, TermsPage, GRIEVANCE_OFFICER } from '../../src/pages/legal/LegalPage';
import { DeletePartnerAccount } from '../../src/pages/partner/components/DeletePartnerAccount';
import { partnerService } from '../../src/services/partner.service';
import { ApiError } from '../../src/services/api';

const logout = vi.fn();
vi.mock('../../src/app/AuthProvider', () => ({ useAuth: () => ({ logout }) }));
vi.mock('../../src/services/partner.service', () => ({ partnerService: { deleteMe: vi.fn() } }));

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('public account-deletion page (ADR-045, Google Play web link)', () => {
  it('explains both roles, what goes, what stays, and a route for people who cannot sign in', () => {
    wrap(<AccountDeletionPage />);
    expect(screen.getByRole('heading', { name: /delete your sahayak account/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /vehicle owner/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /partner/i, level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /what is kept/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /cannot sign in/i })).toBeTruthy();
  });
});

describe('grievance officer (Consumer Protection (E-Commerce) Rules, 2020)', () => {
  it('the terms show the officer, how to reach them, and the 48-hour and one-month timelines', () => {
    wrap(<TermsPage />);
    expect(screen.getByRole('heading', { name: /grievance officer/i })).toBeTruthy();
    expect(screen.getAllByText(GRIEVANCE_OFFICER.email).length).toBeGreaterThan(0);
    expect(screen.getByText(/48 hours/)).toBeTruthy();
    expect(screen.getByText(/within one month/)).toBeTruthy();
  });
});

describe('DeletePartnerAccount', () => {
  it('asks first, then deletes and signs out', async () => {
    vi.mocked(partnerService.deleteMe).mockResolvedValue();
    wrap(<DeletePartnerAccount />);
    fireEvent.click(screen.getByRole('button', { name: /delete partner account/i }));
    expect(partnerService.deleteMe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it('explains a 409 instead of signing out', async () => {
    vi.mocked(partnerService.deleteMe).mockRejectedValue(new ApiError(409, { code: 'ACCOUNT_HAS_ACTIVE_JOB', message: 'busy' }));
    wrap(<DeletePartnerAccount />);
    fireEvent.click(screen.getByRole('button', { name: /delete partner account/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText(/finish your active job/i)).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
  });
});
