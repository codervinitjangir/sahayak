import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../src/app/AuthProvider';
import { LoginPage } from '../../src/pages/auth/LoginPage';
import { getAuthToken } from '../../src/services/authToken';
import type { IdentityResolution } from '../../src/services/identity.service';
import type { OtpOutcome, VerifyOutcome } from '../../src/services/supabase';

/**
 * Supabase stands in for the real auth server, because these tests assert the
 * *flow* — send a code, exchange it, store the token, route on the backend's
 * answer — and a live OTP would put a real SMS in the loop.
 *
 * Note what became testable only after sign-in was implemented. Until 2026-10-06
 * this page advanced its own steps on a timer and navigated by the role toggle, so
 * there was nothing to mock and nothing to assert beyond the keypad: the suite was
 * green while the page produced no token at all.
 */
const sendPhoneOtp = vi.fn<() => Promise<OtpOutcome>>(async () => ({ ok: true }));
const verifyPhoneOtp = vi.fn<() => Promise<VerifyOutcome>>(async () => ({
  ok: true,
  accessToken: 'access-token-xyz',
}));

/**
 * A stored session for AuthProvider to restore on mount. Null here means "nobody
 * is signed in yet", which is the state the login screen starts from — and it
 * exercises the guard that makes AuthProvider leave an existing token alone when
 * Supabase has nothing to offer. Without that guard the restore effect would race
 * the sign-in and wipe the token the OTP had just produced.
 */
let storedSession: { access_token: string } | null = null;

vi.mock('../../src/services/supabase', () => ({
  IS_SUPABASE_CONFIGURED: true,
  sendPhoneOtp: (...args: unknown[]) => sendPhoneOtp(...(args as [])),
  verifyPhoneOtp: (...args: unknown[]) => verifyPhoneOtp(...(args as [])),
  toE164: (dial: string, local: string) => `${dial}${local.replace(/\D/g, '')}`,
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: storedSession } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  }),
  signOut: async () => undefined,
}));

/** What GET /api/v1/auth/me reports for the signed-in account. */
const resolveIdentity = vi.fn<() => Promise<IdentityResolution>>(async () => ({
  kind: 'registered',
  identity: { role: 'user', id: 'usr-1' },
}));

vi.mock('../../src/services/identity.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/identity.service')>(
    '../../src/services/identity.service'
  );
  return {
    ...actual,
    identityService: { resolve: () => resolveIdentity() },
  };
});

/**
 * Mounts the login page with owner/partner destinations so we can assert where
 * a completed sign-in actually lands.
 */
function renderLogin(entry = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/owner" element={<div>Owner Home</div>} />
          <Route path="/owner/signup" element={<div>Owner Signup</div>} />
          <Route path="/owner/request" element={<div>Emergency Request</div>} />
          <Route path="/partner/dashboard" element={<div>Partner Console</div>} />
          <Route path="/partner/preferences" element={<div>Partner Preferences</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

const otpBoxes = () => screen.getAllByRole('textbox', { name: /Digit \d/ }) as HTMLInputElement[];

/** Walks the two-step flow up to the code screen. */
async function advanceToVerifyStep() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Send verification code/i }));
  });
  await waitFor(() => expect(screen.getByText('Enter your code')).toBeInTheDocument(), {
    timeout: 3000,
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    storedSession = null;
    sendPhoneOtp.mockResolvedValue({ ok: true });
    verifyPhoneOtp.mockResolvedValue({ ok: true, accessToken: 'access-token-xyz' });
    resolveIdentity.mockResolvedValue({
      kind: 'registered',
      identity: { role: 'user', id: 'usr-1' },
    });
  });

  it('keeps the submit disabled until the number is the right length for the country', () => {
    renderLogin();

    const submit = screen.getByRole('button', { name: /Send verification code/i });
    expect(submit).toBeEnabled();

    // India expects 10 digits; a short number must not be submittable.
    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: '98765' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: '9876543210' } });
    expect(submit).toBeEnabled();
  });

  it('truncates the number when switching to a country with fewer digits', () => {
    renderLogin();

    const input = screen.getByLabelText(/Mobile number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9876543210' } });

    // Singapore is an 8-digit country — the extra digits must be dropped, not sent.
    fireEvent.change(screen.getByLabelText(/Country calling code/i), { target: { value: '+65' } });
    expect(input.value.replace(/\D/g, '')).toHaveLength(8);
  });

  it('shows the number the code was sent to, and can return to edit it', async () => {
    renderLogin();
    await advanceToVerifyStep();

    // Google's identity-chip idea: never guess which account you are verifying.
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Change$/i }));
    expect(screen.getByText('Get roadside help')).toBeInTheDocument();
  });

  it('advances focus across the OTP boxes as digits are typed', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    expect(boxes).toHaveLength(6);

    fireEvent.change(boxes[0], { target: { value: '4' } });
    expect(boxes[0].value).toBe('4');
    expect(document.activeElement).toBe(boxes[1]);

    // Backspace on an empty box steps back rather than trapping the caret.
    fireEvent.keyDown(boxes[1], { key: 'Backspace' });
    expect(document.activeElement).toBe(boxes[0]);
  });

  it('fills every box from a single pasted code', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    fireEvent.paste(boxes[0], {
      clipboardData: { getData: () => '824193' },
    });

    await waitFor(() => {
      expect(boxes.map((b) => b.value).join('')).toBe('824193');
    });
  });

  it('signs in automatically once the sixth digit lands', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    await act(async () => {
      fireEvent.paste(boxes[0], { clipboardData: { getData: () => '824193' } });
    });

    await waitFor(() => expect(screen.getByText('Owner Home')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('sends the code to the number in E.164 and verifies the digits that were typed', async () => {
    renderLogin();
    await advanceToVerifyStep();

    expect(sendPhoneOtp).toHaveBeenCalledWith('+919876543210');

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '824193' } });
    });

    await waitFor(() => expect(verifyPhoneOtp).toHaveBeenCalledWith('+919876543210', '824193'));
  });

  it('stores the access token so the next request can authenticate', async () => {
    // The point of the whole screen. Without this the app holds a session that
    // looks signed in and sends no Authorization header, which is how every
    // authenticated endpoint came to answer 401.
    renderLogin();
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '824193' } });
    });

    await waitFor(() => expect(getAuthToken()).toBe('access-token-xyz'));
  });

  it('does not leave the number screen when Supabase refuses to send a code', async () => {
    sendPhoneOtp.mockResolvedValue({
      ok: false,
      message: 'Phone sign-in is turned off for this project.',
    });
    renderLogin();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send verification code/i }));
    });

    // Previously the step advanced regardless, so the user typed six digits into a
    // keypad for a code that had never been sent.
    expect(screen.queryByText('Enter your code')).not.toBeInTheDocument();
    expect(await screen.findByText(/turned off for this project/i)).toBeInTheDocument();
  });

  it('rejects a wrong code instead of signing in anyway', async () => {
    verifyPhoneOtp.mockResolvedValue({ ok: false, message: 'That code is not right.' });
    renderLogin();
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '000000' } });
    });

    expect(await screen.findByText(/that code is not right/i)).toBeInTheDocument();
    expect(screen.queryByText('Owner Home')).not.toBeInTheDocument();
    expect(getAuthToken()).toBeNull();
  });

  it('routes by what the backend says the account is, not by the role toggle', async () => {
    // A mechanic who taps "Vehicle owner" still reaches the partner console: the
    // toggle only seeds a phone number, and the token resolves to a row in our own
    // tables. The old version navigated straight off this toggle, so the same
    // mistake sent a mechanic into the owner app with a partner token.
    resolveIdentity.mockResolvedValue({
      kind: 'registered',
      identity: { role: 'partner', id: 'ptr-1' },
    });
    renderLogin();
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '111111' } });
    });

    await waitFor(() => expect(screen.getByText('Partner Console')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('sends a verified account with no profile to signup rather than reporting an error', async () => {
    resolveIdentity.mockResolvedValue({ kind: 'needs-signup' });
    renderLogin();
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '222222' } });
    });

    await waitFor(() => expect(screen.getByText('Owner Signup')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('explains an unlinked profile instead of looping back to signup', async () => {
    // IDENTITY_NOT_LINKED means ops already registered this number and the profile
    // is unclaimed. Sending them to signup would fail on a duplicate phone, and
    // sending them back to OTP would loop forever — the token is already valid.
    resolveIdentity.mockResolvedValue({ kind: 'needs-linking' });
    renderLogin();
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '333333' } });
    });

    expect(await screen.findByText(/not yet linked to this login/i)).toBeInTheDocument();
    expect(screen.queryByText('Owner Signup')).not.toBeInTheDocument();
  });

  it('offers an emergency path that does not require signing in', () => {
    renderLogin();

    const sos = screen.getByRole('link', { name: /Stranded right now/i });
    expect(sos).toHaveAttribute('href', '/owner/request');
  });

  it('returns an owner to the page they came from after signing in', async () => {
    renderLogin('/login?redirect=%2Fowner%2Frequest');
    await advanceToVerifyStep();
    for (const [i, box] of otpBoxes().entries()) {
      await act(async () => {
        fireEvent.change(box, { target: { value: '824193'[i] } });
      });
    }
    await waitFor(() => expect(screen.getByText('Emergency Request')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('ignores a redirect that leaves the owner area (no open redirect)', async () => {
    renderLogin('/login?redirect=https%3A%2F%2Fevil.example');
    await advanceToVerifyStep();
    for (const [i, box] of otpBoxes().entries()) {
      await act(async () => {
        fireEvent.change(box, { target: { value: '824193'[i] } });
      });
    }
    await waitFor(() => expect(screen.getByText('Owner Home')).toBeInTheDocument(), { timeout: 3000 });
  });
});
