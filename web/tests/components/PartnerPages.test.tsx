import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PartnerSignup } from '../../src/pages/partner/PartnerSignup';
import { VerificationStatus } from '../../src/pages/partner/VerificationStatus';
import { Preferences } from '../../src/pages/partner/Preferences';
import { PartnerDashboard } from '../../src/pages/partner/PartnerDashboard';
import { LoginPage } from '../../src/pages/auth/LoginPage';
import { AuthProvider } from '../../src/app/AuthProvider';
import { DEFAULT_PARTNER_PROFILE, saveStoredPartnerProfile } from '../../src/types/partner';
import { partnerService } from '../../src/services/partner.service';
import { jobsService } from '../../src/services/jobs.service';

/**
 * Step 0 of the partner wizard is a real phone OTP. Supabase is mocked so these
 * tests cover the wizard's steps without putting an SMS in the loop.
 */
const sendPhoneOtp = vi.fn(async () => ({ ok: true }));
const verifyPhoneOtp = vi.fn(async () => ({ ok: true, accessToken: 'partner-access-token' }));

vi.mock('../../src/services/supabase', () => ({
  IS_SUPABASE_CONFIGURED: true,
  sendPhoneOtp: (...args: unknown[]) => sendPhoneOtp(...(args as [])),
  verifyPhoneOtp: (...args: unknown[]) => verifyPhoneOtp(...(args as [])),
  toE164: (dial: string, local: string) => `${dial}${local.replace(/\D/g, '')}`,
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  }),
  signOut: async () => undefined,
}));

/** By default: verified, but no Sahayak profile yet, so the wizard continues. */
const resolveIdentity = vi.fn(async () => ({ kind: 'needs-signup' as const }));

vi.mock('../../src/services/identity.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/identity.service')>(
    '../../src/services/identity.service'
  );
  return {
    ...actual,
    identityService: { resolve: () => resolveIdentity() },
  };
});

const CATALOGUE = [
  { id: 1, category_id: 1, code: 'flatbed_towing', name: 'Flatbed towing', requires_vehicle_equipment: true, category: { id: 1, code: 'towing', name: 'Towing' } },
  { id: 4, category_id: 2, code: 'flat_tyre', name: 'Flat tyre', requires_vehicle_equipment: false, category: { id: 2, code: 'mechanical', name: 'On-site repair' } },
  { id: 3, category_id: 2, code: 'battery_jumpstart', name: 'Battery jumpstart', requires_vehicle_equipment: false, category: { id: 2, code: 'mechanical', name: 'On-site repair' } },
];

const STATS = {
  partnerId: 'ptr-1',
  verificationStatus: 'pending',
  acceptanceRatePct: 80,
  ratingAvg: 4.5,
  ratingCount: 10,
  lifetimeJobs: 12,
};

function withProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    ),
  };
}

describe('Partner Flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sendPhoneOtp.mockResolvedValue({ ok: true });
    verifyPhoneOtp.mockResolvedValue({ ok: true, accessToken: 'partner-access-token' });
    resolveIdentity.mockResolvedValue({ kind: 'needs-signup' });
    vi.spyOn(jobsService, 'listServices').mockResolvedValue(CATALOGUE);
    vi.spyOn(partnerService, 'getTrustStats').mockResolvedValue(STATS);
    vi.spyOn(partnerService, 'getMyServices').mockResolvedValue([{ service_id: 4, code: 'flat_tyre', name: 'Flat tyre' }]);
  });

  /** Walks step 0: type the number, request a code, enter six digits, verify. */
  const completeOtpStep = async () => {
    await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543210');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send code/i }));
    });
    await waitFor(() => expect(screen.getByText(/Verify your number/i)).toBeInTheDocument());

    const otpInputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      await userEvent.type(otpInputs[i], '1');
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify & continue/i }));
    });
  };

  describe('PartnerSignup', () => {
    it('renders the phone step and requests a real code', async () => {
      withProviders(<PartnerSignup />);

      expect(screen.getByRole('heading', { name: /Register as a partner/i })).toBeInTheDocument();
      const send = screen.getByRole('button', { name: /Send code/i });
      expect(send).toBeDisabled();

      await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543210');
      expect(send).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(send);
      });

      expect(sendPhoneOtp).toHaveBeenCalledWith('+919876543210');
      expect(screen.getByText(/Verify your number/i)).toBeInTheDocument();
      expect(screen.getByText(/Resend in/i)).toBeInTheDocument();
    });

    it('offers no sample-data shortcuts', () => {
      withProviders(<PartnerSignup />);
      expect(screen.queryByText(/fill sample|autofill/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/1800/)).not.toBeInTheDocument();
    });

    it('stays on the number step when the code could not be sent', async () => {
      sendPhoneOtp.mockResolvedValue({ ok: false, message: 'Phone sign-in is turned off for this project.' } as never);
      withProviders(<PartnerSignup />);

      await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543210');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Send code/i }));
      });

      expect(screen.queryByText(/Verify your number/i)).not.toBeInTheDocument();
      expect(await screen.findByText(/turned off for this project/i)).toBeInTheDocument();
    });

    it('sends an already-registered mechanic to the console instead of through signup', async () => {
      resolveIdentity.mockResolvedValue({ kind: 'registered', identity: { role: 'partner', id: 'ptr-1' } } as never);
      withProviders(<PartnerSignup />);

      await completeOtpStep();

      expect(screen.queryByRole('heading', { name: /About you/i })).not.toBeInTheDocument();
    });

    it('collects a name and category, then real services, and registers the partner', async () => {
      const register = vi.spyOn(partnerService, 'registerPartner').mockResolvedValue({ id: 'ptr-new' } as never);
      const link = vi.spyOn(partnerService, 'linkAuth').mockResolvedValue({} as never);
      const update = vi.spyOn(partnerService, 'updateServices').mockResolvedValue({ partner_id: 'ptr-new', services: [] });

      withProviders(<PartnerSignup />);
      await completeOtpStep();

      // No document upload step exists.
      expect(await screen.findByRole('heading', { name: /About you/i })).toBeInTheDocument();
      expect(screen.queryByText(/Aadhaar|Upload Identity/i)).not.toBeInTheDocument();

      const next = screen.getByRole('button', { name: /^Continue$/i });
      expect(next).toBeDisabled();
      await userEvent.type(screen.getByLabelText(/Your name or business name/i), 'Ravi Kumar');
      fireEvent.click(screen.getByRole('radio', { name: /Mechanical/i }));
      expect(next).not.toBeDisabled();
      fireEvent.click(next);

      // Services come from the live catalogue.
      expect(await screen.findByText('Flat tyre')).toBeInTheDocument();
      expect(screen.getByText('Flatbed towing')).toBeInTheDocument();
      expect(screen.getByText(/Needs equipment verified by Sahayak/i)).toBeInTheDocument();

      const registerBtn = screen.getByRole('button', { name: /^Register$/i });
      expect(registerBtn).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/Flat tyre/i));
      fireEvent.click(registerBtn);

      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      expect(register.mock.calls[0][0]).toMatchObject({ name: 'Ravi Kumar', phone: '+919876543210', primary_category_code: 'mechanical' });
      await waitFor(() => expect(link).toHaveBeenCalledWith('ptr-new'));
      expect(update).toHaveBeenCalledWith('ptr-new', ['flat_tyre']);
      expect(await screen.findByText(/You are registered/i)).toBeInTheDocument();
      expect(screen.getByText(/verifies every partner before they can receive jobs/i)).toBeInTheDocument();
    });

    it('says so and does not claim success when registration fails', async () => {
      vi.spyOn(partnerService, 'registerPartner').mockRejectedValue(new Error('Phone already registered'));
      withProviders(<PartnerSignup />);
      await completeOtpStep();

      await userEvent.type(await screen.findByLabelText(/Your name or business name/i), 'Ravi Kumar');
      fireEvent.click(screen.getByRole('radio', { name: /Mechanical/i }));
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));
      fireEvent.click(await screen.findByLabelText(/Flat tyre/i));
      fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

      expect(await screen.findByText(/Could not complete registration: Phone already registered/i)).toBeInTheDocument();
      expect(screen.queryByText(/You are registered/i)).not.toBeInTheDocument();
    });
  });

  describe('VerificationStatus', () => {
    it('shows the real account status from the backend, with no document checklist', async () => {
      withProviders(<VerificationStatus />);

      expect(screen.getByText('Verification Status')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Verification pending' })).toBeInTheDocument();
      expect(screen.getByText(/verifies every partner before they can receive jobs/i)).toBeInTheDocument();
      expect(screen.queryByText(/Aadhaar|PAN Card|Driving Licence|Re-upload|Tier/i)).not.toBeInTheDocument();
      // Linked services come from the backend too.
      expect(await screen.findByText('Flat tyre')).toBeInTheDocument();
    });

    it.each([
      ['verified', 'You are verified'],
      ['rejected', 'Verification was not approved'],
      ['suspended', 'Your account is suspended'],
    ])('describes a %s account', async (status, title) => {
      vi.spyOn(partnerService, 'getTrustStats').mockResolvedValue({ ...STATS, verificationStatus: status });
      withProviders(<VerificationStatus />);
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    });

    it('reports a failed load instead of guessing a status', async () => {
      vi.spyOn(partnerService, 'getTrustStats').mockRejectedValue(new Error('down'));
      withProviders(<VerificationStatus />);
      expect(await screen.findByText(/could not load your verification status/i)).toBeInTheDocument();
      expect(screen.queryByText(/You are verified/i)).not.toBeInTheDocument();
    });
  });

  describe('Preferences', () => {
    it('lists the live catalogue with the partner\'s linked services ticked', async () => {
      withProviders(<Preferences />);

      expect(await screen.findByText('Flatbed towing')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Flat tyre/i)).toBeChecked());
      expect(screen.getByLabelText(/Battery jumpstart/i)).not.toBeChecked();
      expect(screen.getByText(/Needs equipment verified by Sahayak/i)).toBeInTheDocument();
    });

    it('invents no marketing statistics', async () => {
      const { container } = withProviders(<Preferences />);
      await screen.findByText('Flatbed towing');
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/500\+|₹\s?\d|15 Mins|Thousands of/i);
    });

    it('saves the full set of selected service codes for this partner', async () => {
      const update = vi.spyOn(partnerService, 'updateServices').mockResolvedValue({ partner_id: 'ptr-1', services: [] });
      withProviders(<Preferences />);

      await waitFor(() => expect(screen.getByLabelText(/Flat tyre/i)).toBeChecked());
      const save = screen.getByRole('button', { name: /Save services/i });
      expect(save).toBeDisabled(); // nothing changed yet

      fireEvent.click(screen.getByLabelText(/Battery jumpstart/i));
      expect(save).not.toBeDisabled();
      fireEvent.click(save);

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update.mock.calls[0][0]).toBe('ptr-1');
      expect([...update.mock.calls[0][1]].sort()).toEqual(['battery_jumpstart', 'flat_tyre']);
      expect(await screen.findByText(/Services saved/i)).toBeInTheDocument();
    });

    it('shows the failure when saving does not reach the backend', async () => {
      vi.spyOn(partnerService, 'updateServices').mockRejectedValue(new Error('Equipment not verified'));
      withProviders(<Preferences />);
      await waitFor(() => expect(screen.getByLabelText(/Flat tyre/i)).toBeChecked());

      fireEvent.click(screen.getByLabelText(/Battery jumpstart/i));
      fireEvent.click(screen.getByRole('button', { name: /Save services/i }));

      expect(await screen.findByText(/Equipment not verified/i)).toBeInTheDocument();
      expect(screen.queryByText(/Services saved/i)).not.toBeInTheDocument();
    });

    it('toggles duty between On Duty and Off Duty', () => {
      saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
      withProviders(<Preferences />);

      const availSwitch = screen.getByRole('switch', { name: /Go on duty/i });
      expect(availSwitch).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('heading', { name: 'On Duty' })).toBeInTheDocument();

      fireEvent.click(availSwitch);
      expect(availSwitch).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('heading', { name: 'Off Duty' })).toBeInTheDocument();
    });
  });

  describe('PartnerDashboard', () => {
    const renderDashboard = (setup?: (qc: QueryClient) => void) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      setup?.(queryClient);
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <PartnerDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      );
    };

    it('renders the idle state with one plain sentence and no marketing filler', () => {
      saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
      renderDashboard((qc) => {
        qc.setQueryData(['partner', 'active-job'], null);
        qc.setQueryData(['partner', 'offer'], null);
      });

      expect(screen.getByText("You're available. Waiting for the next job.")).toBeInTheDocument();
      expect(screen.queryByText(/You are in the dispatch pool/i)).not.toBeInTheDocument();
      expect(screen.getByText('On Duty')).toBeInTheDocument();
    });

    it('never shows invented operational details', () => {
      saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, name: 'Ravi Kumar', isAvailable: true });
      const { container } = renderDashboard();
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/East Bengaluru|Indiranagar Hub|3\.5 Tonnes|Live \(1m ago\)|on the roster/i);
    });

    it('shows earnings trend when switching to This Week', async () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);
      renderDashboard((qc) =>
        qc.setQueryData(['partner', 'earnings', 'week'], {
          window: 'week',
          jobsCompleted: 12,
          amountEarned: 55000,
          previousAmountEarned: 47900,
        })
      );

      fireEvent.click(screen.getByRole('button', { name: 'This Week' }));
      await waitFor(() => expect(screen.getByText('+14.8%')).toBeInTheDocument());
      expect(screen.getByText('vs last week')).toBeInTheDocument();
    });

    describe('exactly one overlay renders per state', () => {
      it('off duty', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: false });
        renderDashboard();
        expect(screen.getByTestId('map-overlay-off-duty')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-idle')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-pending-offer')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-active-job')).not.toBeInTheDocument();
      });

      it('on duty with nothing to do', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        renderDashboard((qc) => {
          qc.setQueryData(['partner', 'active-job'], null);
          qc.setQueryData(['partner', 'offer'], null);
        });
        expect(screen.getByTestId('map-overlay-idle')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-off-duty')).not.toBeInTheDocument();
      });

      it('an incoming offer', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        renderDashboard((qc) => {
          qc.setQueryData(['partner', 'active-job'], null);
          qc.setQueryData(['partner', 'offer'], {
            id: 'offer-test-1',
            serviceName: 'Flat-Tyre Support',
            vehicleNumber: 'KA-05-NB-1290',
            pickupAddressText: '100ft Road, Indiranagar',
            distanceAtOfferM: 2400,
            offeredAt: new Date().toISOString(),
          });
        });
        expect(screen.getByTestId('map-overlay-pending-offer')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-idle')).not.toBeInTheDocument();
      });

      it('an active job', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        renderDashboard((qc) =>
          qc.setQueryData(['partner', 'active-job'], {
            id: 'job-test-1',
            status: 'assigned',
            service: { name: 'Battery Jumpstart' },
            vehicle_number: 'KA-01-AB-1234',
            pickup_address_text: 'Indiranagar, Bengaluru',
          })
        );
        expect(screen.getByTestId('map-overlay-active-job')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-pending-offer')).not.toBeInTheDocument();
      });
    });

    it('renders the four dashboard cards', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);
      renderDashboard();

      expect(screen.getByLabelText(/Earnings and performance/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Service Capabilities/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Recent Jobs/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Partner Profile/i)).toBeInTheDocument();
    });
  });

  describe('LoginPage', () => {
    it('renders the role switcher and swaps context between Owner and Partner sign in', () => {
      render(
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByText('Get roadside help')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('98765 43210')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /Service Partner/i }));
      expect(screen.getByText('Partner sign in')).toBeInTheDocument();
      expect(screen.getByText(/New to the network\?/i)).toBeInTheDocument();
      expect(screen.getByText(/Register as a partner/i)).toBeInTheDocument();
    });
  });
});
