import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PartnerSignup } from '../../src/pages/partner/PartnerSignup';
import { VerificationStatus } from '../../src/pages/partner/VerificationStatus';
import { Preferences } from '../../src/pages/partner/Preferences';
import { PartnerDashboard } from '../../src/pages/partner/PartnerDashboard';
import { LoginPage } from '../../src/pages/auth/LoginPage';
import { AuthProvider } from '../../src/app/AuthProvider';
import { DEFAULT_PARTNER_PROFILE, saveStoredPartnerProfile, PartnerProfile } from '../../src/types/partner';

describe('Partner Flow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** The console shell is data-connected (the sidebar shows the shift summary),
   *  so anything that renders it needs the provider the real app has at root. */
  const renderInConsole = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  describe('PartnerSignup', () => {
    it('renders step 0 phone input and allows sending OTP', async () => {
      render(
        <MemoryRouter>
          <PartnerSignup />
        </MemoryRouter>
      );

      expect(screen.getByText(/Partner Sign In \/ Sign Up/i)).toBeInTheDocument();
      const phoneInput = screen.getByPlaceholderText('98765 43210');
      const sendOtpBtn = screen.getByRole('button', { name: /Send OTP/i });

      // Initially disabled for short numbers
      expect(sendOtpBtn).toBeDisabled();

      await userEvent.type(phoneInput, '9876543210');
      expect(sendOtpBtn).not.toBeDisabled();

      fireEvent.click(sendOtpBtn);

      // Now on OTP entry screen
      expect(screen.getByText(/Verify your number/i)).toBeInTheDocument();
      expect(screen.getByText(/Resend OTP in/i)).toBeInTheDocument();
    });

    it('advances through reordered steps with Tier 1 Documents gating Category', async () => {
      render(
        <MemoryRouter>
          <PartnerSignup />
        </MemoryRouter>
      );

      // 1. Enter phone
      const phoneInput = screen.getByPlaceholderText('98765 43210');
      await userEvent.type(phoneInput, '9876543210');
      fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

      // 2. Enter OTP
      const otpInputs = screen.getAllByRole('textbox');
      for (let i = 0; i < 6; i++) {
        await userEvent.type(otpInputs[i], '1');
      }
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      // 3. Step 1: Tier 1 Identity Documents (Prerequisite)
      expect(screen.getByText(/Upload Identity Documents/i)).toBeInTheDocument();
      expect(screen.getByText(/Tier 1 · Hard Prerequisite/i)).toBeInTheDocument();
      expect(screen.getByText('Aadhaar Card')).toBeInTheDocument();
      expect(screen.getByText('PAN Card')).toBeInTheDocument();
      expect(screen.getByText('Driving Licence')).toBeInTheDocument();

      // Continue button should be disabled until all 3 are uploaded
      const continueBtn = screen.getByRole('button', { name: /Continue/i });
      expect(continueBtn).toBeDisabled();

      // Autofill sample docs
      fireEvent.click(screen.getByRole('button', { name: /Autofill sample docs/i }));
      expect(continueBtn).not.toBeDisabled();
      fireEvent.click(continueBtn);

      // 4. Step 2: Capability & Category Selection (Unlocked by Tier 1)
      expect(screen.getByText(/Select Your Service Capability/i)).toBeInTheDocument();
      expect(screen.getByText('Towing')).toBeInTheDocument();
      expect(screen.getByText('Mechanical')).toBeInTheDocument();
      expect(screen.getByText('Both (Tow & Mechanic)')).toBeInTheDocument();
      expect(screen.getByText('Fuel Delivery')).toBeInTheDocument();

      // Select Mechanical
      fireEvent.click(screen.getByText('Mechanical'));
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      // 5. Step 3: Offered Services
      expect(screen.getByText(/Offered Services/i)).toBeInTheDocument();
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
      expect(screen.getByText('Battery Jumpstart')).toBeInTheDocument();
      expect(screen.getByText('On-Site Minor Repair')).toBeInTheDocument();
    });

    it('renders both towing and mechanical service groups when Both is selected', async () => {
      render(
        <MemoryRouter>
          <PartnerSignup />
        </MemoryRouter>
      );

      // Enter phone and submit OTP
      const phoneInput = screen.getByPlaceholderText('98765 43210');
      await userEvent.type(phoneInput, '9876543210');
      fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

      const otpInputs = screen.getAllByRole('textbox');
      for (let i = 0; i < 6; i++) {
        await userEvent.type(otpInputs[i], '1');
      }
      fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

      // Complete Tier 1 Documents
      fireEvent.click(screen.getByRole('button', { name: /Autofill sample docs/i }));
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      // Select Both (Tow & Mechanic)
      fireEvent.click(screen.getByText('Both (Tow & Mechanic)'));
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

      // Both service categories should be rendered
      expect(screen.getByText('Towing Services')).toBeInTheDocument();
      expect(screen.getByText('Mechanical & On-Site Services')).toBeInTheDocument();
      expect(screen.getByText('Flatbed Towing')).toBeInTheDocument();
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
    });
  });

  describe('VerificationStatus', () => {
    it('renders Two-Tier grouping (Tier 1 Identity & Tier 2 Capabilities) and sample job walkthrough', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);

      renderInConsole(<VerificationStatus />);

      expect(screen.getByText('Verification Status')).toBeInTheDocument();
      expect(screen.getByText('Identity Verification')).toBeInTheDocument();
      expect(screen.getByText('Services & Equipment')).toBeInTheDocument();
      expect(screen.getByText('Aadhaar Card')).toBeInTheDocument();
      expect(screen.getByText('Sample Job Walkthrough')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start Walkthrough/i })).toBeInTheDocument();
    });

    it('displays status change toast notification on status update simulation', async () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);

      renderInConsole(<VerificationStatus />);

      const demoBtn = screen.getByRole('button', { name: /Demo Simulation/i });
      fireEvent.click(demoBtn);

      // Toast should appear with status update notification
      expect(screen.getByRole('complementary', { name: /Status notification/i })).toBeInTheDocument();
    });

    it('shows locked Tier 2 capabilities when Tier 1 is incomplete', () => {
      const incompleteTier1Profile: PartnerProfile = {
        ...DEFAULT_PARTNER_PROFILE,
        verificationItems: [
          { id: 'doc_aadhaar', label: 'Aadhaar Card', type: 'document', tier: 'tier_1_identity', status: 'in_progress' },
          { id: 'doc_pan', label: 'PAN Card', type: 'document', tier: 'tier_1_identity', status: 'not_started' },
          { id: 'doc_dl', label: 'Driving Licence', type: 'document', tier: 'tier_1_identity', status: 'not_started' },
          { id: 'svc_flat_tyre', label: 'Flat-Tyre Support', type: 'service', tier: 'tier_2_capabilities', status: 'not_started' },
        ],
      };
      saveStoredPartnerProfile(incompleteTier1Profile);

      renderInConsole(<VerificationStatus />);

      expect(screen.getByText(/Identity verification required:/i)).toBeInTheDocument();
      expect(screen.getByText(/Complete identity verification first before Tier 2 capabilities unlock/i)).toBeInTheDocument();
    });
  });

  describe('Preferences', () => {


    it('renders STEP 1 OF 3 with thin segmented progress bar and desktop proof stats panel', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);

      render(
        <MemoryRouter>
          <Preferences />
        </MemoryRouter>
      );

      // Segmented progress header
      expect(screen.getByText(/STEP 1 OF 3/i)).toBeInTheDocument();

      // Step 1 title & category options
      expect(screen.getByText('Service Category')).toBeInTheDocument();
      expect(screen.getByText('Towing')).toBeInTheDocument();
      expect(screen.getByText('Mechanical')).toBeInTheDocument();
      expect(screen.getByText('Both (Tow & Mechanic)')).toBeInTheDocument();

      // Right-side proof & trust panel (WeWorkRemotely layout)
      expect(
        screen.getByText(/Thousands of roadside rescue requests dispatched across Bengaluru daily\./i)
      ).toBeInTheDocument();
      expect(screen.getByText('500+')).toBeInTheDocument();
      expect(screen.getByText('₹8,400')).toBeInTheDocument();
      expect(screen.getByText('15 Mins')).toBeInTheDocument();
    });

    it('shows inline "Identity Verification Required" warning when Tier 1 is incomplete', () => {
      const incompleteProfile: PartnerProfile = {
        ...DEFAULT_PARTNER_PROFILE,
        verificationItems: [
          { id: 'doc_aadhaar', label: 'Aadhaar Card', type: 'document', tier: 'tier_1_identity', status: 'in_progress' },
          { id: 'doc_pan', label: 'PAN Card', type: 'document', tier: 'tier_1_identity', status: 'not_started' },
          { id: 'doc_dl', label: 'Driving Licence', type: 'document', tier: 'tier_1_identity', status: 'not_started' },
        ],
      };
      saveStoredPartnerProfile(incompleteProfile);

      render(
        <MemoryRouter>
          <Preferences />
        </MemoryRouter>
      );

      expect(screen.getByText(/Identity Verification Required/i)).toBeInTheDocument();
      expect(screen.getByText(/Upload Tier 1 Documents →/i)).toBeInTheDocument();
    });

    it('advances step-wise from Step 1 to Step 2 to Step 3 and saves preferences', async () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);

      render(
        <MemoryRouter>
          <Preferences />
        </MemoryRouter>
      );

      // ── Step 1: Select Both
      fireEvent.click(screen.getByText('Both (Tow & Mechanic)'));
      fireEvent.click(screen.getByRole('button', { name: /Next: Configure Services/i }));

      // ── Step 2: Offered Services
      expect(screen.getByText(/STEP 2 OF 3/i)).toBeInTheDocument();
      expect(screen.getByText('Offered Services')).toBeInTheDocument();

      // Toggle flatbed tow
      const flatbedRow = screen.getByText('Flatbed Towing');
      fireEvent.click(flatbedRow);

      fireEvent.click(screen.getByRole('button', { name: /Next: Vehicle & Equipment/i }));

      // ── Step 3: Vehicles & Equipment
      expect(screen.getByText(/STEP 3 OF 3/i)).toBeInTheDocument();
      expect(screen.getByText('Vehicles & Equipment')).toBeInTheDocument();
      expect(screen.getByText('Example: KA 01 AB 1234')).toBeInTheDocument();

      // Enter registration
      const regInput = screen.getByPlaceholderText('KA 01 AB 1234');
      await userEvent.type(regInput, 'KA 05 MN 9988');

      // Click Save
      fireEvent.click(screen.getByRole('button', { name: /Save & Update Preferences/i }));

      // Feedback banner
      expect(
        screen.getByText(/Preferences saved and capabilities submitted for verification!/i)
      ).toBeInTheDocument();
    });

    it('toggles master availability between On Duty and Off Duty', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);

      render(
        <MemoryRouter>
          <Preferences />
        </MemoryRouter>
      );

      const availSwitch = screen.getByRole('switch', { name: /Toggle availability/i });
      expect(availSwitch).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('On Duty')).toBeInTheDocument();

      fireEvent.click(availSwitch);
      expect(availSwitch).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText('Off Duty')).toBeInTheDocument();
    });
  });

  describe('PartnerDashboard', () => {
    it('renders the idle state with the specified single plain sentence and no marketing filler', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <PartnerDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Hero sentence
      expect(screen.getByText("You're available. Waiting for the next job.")).toBeInTheDocument();
      // Ensure verbose marketing copy is gone
      expect(screen.queryByText(/You are in the dispatch pool/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Matched for/i)).not.toBeInTheDocument();

      // Check Command bar
      expect(screen.getByText('On Duty')).toBeInTheDocument();

      // Check tabular numbers presence
      expect(screen.getByText(/checks cleared/i)).toBeInTheDocument();
    });

    it('shows earnings trend indicator when switching to This Week tab', async () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <PartnerDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Switch to This Week
      fireEvent.click(screen.getByRole('button', { name: 'This Week' }));

      // Expect trend indicator once earnings data settles
      await waitFor(() => {
        expect(screen.getByText('+14.8%')).toBeInTheDocument();
      });
      expect(screen.getByText('vs last week')).toBeInTheDocument();
    });

    describe('State-Exclusivity: exactly one map overlay renders per state', () => {
      it('renders ONLY map-overlay-off-duty when partner is off duty', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: false });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <PartnerDashboard />
            </MemoryRouter>
          </QueryClientProvider>
        );

        expect(screen.getByTestId('map-overlay-off-duty')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-idle')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-pending-offer')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-active-job')).not.toBeInTheDocument();
      });

      it('renders ONLY map-overlay-idle when on duty with no active job or offer', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(['partner', 'active-job'], null);
        queryClient.setQueryData(['partner', 'offer'], null);

        render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <PartnerDashboard />
            </MemoryRouter>
          </QueryClientProvider>
        );

        expect(screen.getByTestId('map-overlay-idle')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-off-duty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-pending-offer')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-active-job')).not.toBeInTheDocument();
      });

      it('renders ONLY map-overlay-pending-offer when an incoming offer arrives', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(['partner', 'active-job'], null);
        queryClient.setQueryData(['partner', 'offer'], {
          id: 'offer-test-1',
          serviceName: 'Flat-Tyre Support',
          vehicleNumber: 'KA-05-NB-1290',
          payoutEstimate: 850,
          pickupAddressText: '100ft Road, Indiranagar',
          distanceAtOfferM: 2400,
          offeredAt: new Date().toISOString(),
        });

        render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <PartnerDashboard />
            </MemoryRouter>
          </QueryClientProvider>
        );

        expect(screen.getByTestId('map-overlay-pending-offer')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-off-duty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-idle')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-active-job')).not.toBeInTheDocument();
      });

      it('renders ONLY map-overlay-active-job when partner has an active job in progress', () => {
        saveStoredPartnerProfile({ ...DEFAULT_PARTNER_PROFILE, isAvailable: true });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(['partner', 'active-job'], {
          id: 'job-test-1',
          status: 'assigned',
          service: { name: 'Battery Jumpstart' },
          vehicle_number: 'KA-01-AB-1234',
          pickup_address_text: 'Indiranagar, Bengaluru',
          pickup_location: { latitude: 12.97, longitude: 77.59, address: 'Indiranagar' },
        });

        render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <PartnerDashboard />
            </MemoryRouter>
          </QueryClientProvider>
        );

        expect(screen.getByTestId('map-overlay-active-job')).toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-off-duty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-idle')).not.toBeInTheDocument();
        expect(screen.queryByTestId('map-overlay-pending-offer')).not.toBeInTheDocument();
      });
    });

    it('renders all four purpose-built cards in the coordinated right-column bento stack', () => {
      saveStoredPartnerProfile(DEFAULT_PARTNER_PROFILE);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <PartnerDashboard />
          </MemoryRouter>
        </QueryClientProvider>
      );

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

      // Default: Owner
      expect(screen.getByText('Get roadside help')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('98765 43210')).toBeInTheDocument();

      // Switch to Partner
      fireEvent.click(screen.getByRole('radio', { name: /Service Partner/i }));
      expect(screen.getByText('Partner dispatch console')).toBeInTheDocument();
      expect(screen.getByText(/New to the network\?/i)).toBeInTheDocument();
      expect(screen.getByText(/Register as a partner/i)).toBeInTheDocument();
    });
  });
});
