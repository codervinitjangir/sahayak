import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Check, ShieldCheck, MapPin, Gauge } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { setAuthToken } from '../../services/authToken';
import { homeRouteForRole, identityService } from '../../services/identity.service';
import {
  IS_SUPABASE_CONFIGURED,
  sendPhoneOtp,
  toE164,
  verifyPhoneOtp,
} from '../../services/supabase';
import { Logo } from '../../components/Logo';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

type LoginRole = 'owner' | 'partner';
type Step = 'identify' | 'verify';
type SubmitStatus = 'idle' | 'sending' | 'sent';

interface DialCode {
  code: string;
  iso: string;
  label: string;
  digits: number;
}

const DIAL_CODES: DialCode[] = [
  { code: '+91', iso: 'IN', label: 'India', digits: 10 },
  { code: '+971', iso: 'AE', label: 'United Arab Emirates', digits: 9 },
  { code: '+65', iso: 'SG', label: 'Singapore', digits: 8 },
  { code: '+44', iso: 'GB', label: 'United Kingdom', digits: 10 },
  { code: '+1', iso: 'US', label: 'United States', digits: 10 },
];

/** Dev-server convenience only. A production bundle starts with an empty field. */
const SEEDED_NUMBER: Record<LoginRole, string> = import.meta.env.DEV
  ? { owner: '9876543210', partner: '9811122334' }
  : { owner: '', partner: '' };



/** Groups a national number for readability: 98765 43210. */
function formatNumber(digits: string): string {
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}




/**
 * Where to send an owner after sign-in. Only same-site owner paths are honoured, so
 * a crafted `?redirect=https://elsewhere` can never turn this page into an open redirect.
 */
function safeOwnerRedirect(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/owner') || raw.startsWith('//') || raw.includes('://')) return null;
  // A registered owner has no business on the signup form.
  if (raw.startsWith('/owner/signup')) return null;
  return raw;
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeOwnerRedirect(searchParams.get('redirect'));
  const { setRole, setToken } = useAuth();

  const [loginRole, setLoginRole] = useState<LoginRole>('owner');
  const [step, setStep] = useState<Step>('identify');
  const [dial, setDial] = useState<DialCode>(DIAL_CODES[0]);
  const [phone, setPhone] = useState<string>(SEEDED_NUMBER.owner);
  const [otp, setOtp] = useState<string[]>(() => Array(OTP_LENGTH).fill(''));
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<boolean>(false);
  const [resendIn, setResendIn] = useState<number>(RESEND_SECONDS);


  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const timeouts = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /**
   * The last code the auto-submit effect already tried.
   *
   * The effect fires whenever six digits are present and the form is idle, and a
   * failed verification necessarily returns to idle with all six digits still on
   * screen — so without this it re-submits the same wrong code in a loop, against
   * a rate-limited auth server. Cleared when the user edits a digit, so correcting
   * one and re-filling it submits again as expected.
   */
  const attemptedCode = useRef<string | null>(null);

  const phoneComplete = phone.length === dial.digits;
  const otpValue = otp.join('');

  /** Every deferred transition is tracked so nothing fires after unmount. */
  const defer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timeouts.current.push(id);
  }, []);

  useEffect(
    () => () => {
      timeouts.current.forEach(clearTimeout);
    },
    []
  );

  // Resend countdown, only while the verify step is on screen.
  useEffect(() => {
    if (step !== 'verify' || resendIn <= 0) return undefined;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [step, resendIn]);

  const handleRoleChange = (next: LoginRole) => {
    setLoginRole(next);
    setStep('identify');
    setOtp(Array(OTP_LENGTH).fill(''));
    setError(null);
    setOtpError(false);
    setStatus('idle');
    setDial(DIAL_CODES[0]);
    setPhone(SEEDED_NUMBER[next]);
  };

  /**
   * Step 1 → 2. Asks Supabase to send the code, and only advances if it did.
   *
   * Before 2026-10-06 this advanced on a timer without calling anything, so the
   * screen reached the OTP boxes whether or not a code had been sent — and the
   * verify step below accepted any six digits. Nothing in the flow produced a
   * token, which is why every authenticated endpoint answered 401.
   */
  const handleSendCode = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!phoneComplete) {
      setError(`Enter your ${dial.digits}-digit mobile number to continue.`);
      return;
    }
    if (!IS_SUPABASE_CONFIGURED) {
      setError(
        'Sign-in is not configured in this build. Copy web/.env.example to web/.env and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
      );
      return;
    }

    setError(null);
    setStatus('sending');

    const outcome = await sendPhoneOtp(toE164(dial.code, phone));
    if (!outcome.ok) {
      setStatus('idle');
      setError(outcome.message ?? 'Could not send the code. Try again.');
      return;
    }

    setStatus('sent');
    defer(() => {
      setStep('verify');
      setStatus('idle');
      setResendIn(RESEND_SECONDS);
      defer(() => otpRefs.current[0]?.focus(), 60);
    }, 420);
  };

  /**
   * Step 2. Verifies the code with Supabase, stores the access token, then asks
   * the backend who this account is and routes on the answer.
   *
   * The role the user picked on the previous screen is *not* what decides where
   * they land. That toggle only seeds a phone number; a token resolves to a row
   * in our own tables, and `GET /api/v1/auth/me` is the only thing that knows
   * which. A mechanic who taps "Vehicle owner" by mistake still reaches the
   * partner console.
   */
  const handleVerify = useCallback(
    async (code: string) => {
      if (code.length < OTP_LENGTH) {
        setOtpError(true);
        setError('Enter all six digits of the code we sent you.');
        return;
      }
      setError(null);
      setStatus('sending');

      const verified = await verifyPhoneOtp(toE164(dial.code, phone), code);
      if (!verified.ok || !verified.accessToken) {
        setStatus('idle');
        setOtpError(true);
        setError(verified.message ?? 'That code did not work. Try again.');
        return;
      }

      // Stored before the next call, because that call needs it as its bearer.
      setAuthToken(verified.accessToken);
      setToken(verified.accessToken);

      const resolution = await identityService.resolve();
      setStatus('idle');

      switch (resolution.kind) {
        case 'registered':
          // An admin must get the ops role: /admin/:tab is guarded on it.
          setRole(
            resolution.identity.role === 'partner'
              ? 'partner'
              : resolution.identity.role === 'admin'
                ? 'ops'
                : 'owner'
          );
          navigate(
            resolution.identity.role === 'user' && redirectTo
              ? redirectTo
              : homeRouteForRole(resolution.identity.role),
            { replace: true }
          );
          return;

        case 'needs-signup':
          // The token is good; there is simply no profile behind it yet. The
          // signup form posts to POST /api/v1/users, which requires exactly this
          // token — so this screen must not be reachable before sign-in.
          navigate(
            loginRole === 'partner'
              ? '/partner/signup'
              : `/owner/signup${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}`,
            { replace: true }
          );
          return;

        case 'needs-linking':
          // A profile registered with this number exists and is unclaimed. The
          // link-auth endpoints need its id, which this account has no way to
          // learn — so the honest answer is to say so rather than loop them
          // through a signup form that will reject their number as taken.
          setError(
            'A Sahayak profile is already registered with this number but is not yet linked to this login. Ask the Sahayak team to finish linking your account.'
          );
          return;

        case 'error':
        default:
          setError(resolution.message || 'Signed in, but could not load your profile.');
          return;
      }
    },
    [dial.code, loginRole, navigate, phone, redirectTo, setRole, setToken]
  );

  // Auto-submit the moment the sixth digit lands — no extra tap on a roadside.
  useEffect(() => {
    if (step !== 'verify' || otpValue.length !== OTP_LENGTH || status !== 'idle') return;
    if (attemptedCode.current === otpValue) return;
    attemptedCode.current = otpValue;
    void handleVerify(otpValue);
  }, [step, otpValue, status, handleVerify]);

  const writeOtp = (startIndex: number, digits: string) => {
    setOtp((prev) => {
      const next = [...prev];
      for (let i = 0; i < digits.length && startIndex + i < OTP_LENGTH; i += 1) {
        next[startIndex + i] = digits[i];
      }
      return next;
    });
  };

  const handleOtpInput = (index: number, raw: string) => {
    setError(null);
    setOtpError(false);
    // Editing any digit makes this a different code, so the auto-submit guard is
    // released and a corrected code is tried again.
    attemptedCode.current = null;
    const digits = raw.replace(/\D/g, '');

    if (!digits) {
      setOtp((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    writeOtp(index, digits);
    const landing = Math.min(index + digits.length, OTP_LENGTH - 1);
    otpRefs.current[landing]?.focus();
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !otp[index] && index > 0) {
      event.preventDefault();
      otpRefs.current[index - 1]?.focus();
      setOtp((prev) => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
    if (event.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!digits) return;
    event.preventDefault();
    setOtp(() => {
      const next: string[] = Array(OTP_LENGTH).fill('');
      digits.split('').forEach((d, i) => {
        next[i] = d;
      });
      return next;
    });
    otpRefs.current[Math.min(digits.length, OTP_LENGTH - 1)]?.focus();
  };

  const handleEditNumber = () => {
    setStep('identify');
    setOtp(Array(OTP_LENGTH).fill(''));
    setError(null);
    setStatus('idle');
  };

  /** Asks Supabase for a fresh code; the timer only restarts if one was actually sent. */
  const handleResend = async () => {
    if (resendIn > 0 || status !== 'idle') return;
    setOtp(Array(OTP_LENGTH).fill(''));
    attemptedCode.current = null;
    setError(null);
    setStatus('sending');
    const outcome = await sendPhoneOtp(toE164(dial.code, phone));
    setStatus('idle');
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not send a new code. Try again.');
      return;
    }
    setResendIn(RESEND_SECONDS);
    otpRefs.current[0]?.focus();
  };

  const isOwner = loginRole === 'owner';
  const busy = status !== 'idle';
  const onVerifyStep = step === 'verify';

  // First empty box. It gets a resting outline so there is a visible "you are
  // here" without a blinking caret — the page has no motion by design.
  const nextOtpIndex = otp.findIndex((d) => !d);

  const submitLabel = () => {
    if (status === 'sending') return onVerifyStep ? 'Verifying…' : 'Sending code…';
    if (status === 'sent') return 'Code sent';
    return onVerifyStep ? 'Verify & continue' : 'Send verification code';
  };


  const inputBase =
    'w-full min-h-[52px] rounded-control border bg-white px-4 text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700';

  const primaryBtn =
    'w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-control bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-white font-semibold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel (desktop only) */}
      <aside className="hidden lg:flex flex-col justify-between bg-brand-900 text-white p-12">
        <Logo tone="light" />
        <div>
          <h2 className="text-4xl font-bold tracking-tight leading-tight max-w-md">
            Help for the breakdown you did not plan for.
          </h2>
          <ul className="mt-8 space-y-5 max-w-md">
            {[
              { icon: MapPin, text: 'Share your location and what went wrong in under a minute.' },
              { icon: Gauge, text: 'Matched to a partner on distance, rating and reliability.' },
              { icon: ShieldCheck, text: 'Verified partners only. Your number is shared once matched.' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-brand-100">
                <Icon className="w-5 h-5 mt-0.5 shrink-0 text-brand-200" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-200">In immediate danger? Call 112.</p>
      </aside>

      {/* Form */}
      <main className="flex flex-col min-h-screen px-5 sm:px-10">
        <div className="flex items-center justify-between h-16">
          <Link to="/" aria-label="Sahayak home" className="lg:invisible">
            <Logo />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-ink-soft hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to site</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-md mx-auto py-8">
            {!onVerifyStep ? (
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  {isOwner ? 'Get roadside help' : 'Partner sign in'}
                </h1>
                <p className="mt-2 text-ink-soft">
                  {isOwner
                    ? 'Sign in to request help or manage your vehicles.'
                    : 'Sign in to go on shift, accept jobs and manage your services.'}
                </p>

                <div
                  className="mt-6 grid grid-cols-2 gap-1 p-1 rounded-control bg-slate-100"
                  role="radiogroup"
                  aria-label="Choose account type"
                >
                  {(['owner', 'partner'] as const).map((r) => {
                    const active = loginRole === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleRoleChange(r)}
                        className={`min-h-[44px] rounded-[10px] text-sm font-semibold transition-colors ${
                          active ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'
                        }`}
                      >
                        {r === 'owner' ? 'Vehicle Owner' : 'Service Partner'}
                      </button>
                    );
                  })}
                </div>

                <form onSubmit={handleSendCode} className="mt-6">
                  <label htmlFor="auth-phone" className="block text-sm font-semibold mb-2">
                    Mobile number
                  </label>
                  <div className="flex gap-2">
                    <div className="relative w-[104px] shrink-0">
                      <select
                        className={`${inputBase} appearance-none pr-2 ${
                          error && !phoneComplete ? 'border-emergency-600' : 'border-line'
                        }`}
                        aria-label="Country calling code"
                        value={dial.code}
                        onChange={(e) => {
                          const next = DIAL_CODES.find((d) => d.code === e.target.value);
                          if (!next) return;
                          setDial(next);
                          setPhone((prev) => prev.slice(0, next.digits));
                          setError(null);
                        }}
                      >
                        {DIAL_CODES.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.code} {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      id="auth-phone"
                      className={`${inputBase} tnum ${
                        error && !phoneComplete ? 'border-emergency-600' : 'border-line'
                      }`}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={dial.digits + 1}
                      value={formatNumber(phone)}
                      onChange={(e) => {
                        setPhone(e.target.value.replace(/\D/g, '').slice(0, dial.digits));
                        setError(null);
                      }}
                      placeholder={dial.iso === 'IN' ? '98765 43210' : 'Mobile number'}
                      autoFocus
                    />
                  </div>

                  {/* QA shortcut: dev server only, never in a production bundle. */}
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      onClick={() => setPhone(isOwner ? '9000000901' : '9000000902')}
                      className="mt-2 inline-flex items-center min-h-[32px] px-3 text-xs font-medium rounded-full bg-amber-50 text-status-warning border border-amber-200"
                    >
                      Dev: use test number {isOwner ? '9000000901' : '9000000902'} (code 123456)
                    </button>
                  )}

                  <p className="mt-3 text-sm text-ink-muted">
                    No password needed. We&rsquo;ll text you a 6-digit code.
                  </p>

                  {error && (
                    <div
                      className="mt-4 flex gap-2 rounded-control bg-emergency-50 border border-emergency-100 p-3 text-sm text-emergency-700"
                      role="alert"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button type="submit" disabled={!phoneComplete || busy} className={`${primaryBtn} mt-5`}>
                    {status === 'sent' && <Check className="w-5 h-5" aria-hidden="true" />}
                    <span>{submitLabel()}</span>
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Enter your code</h1>
                <p className="mt-2 text-ink-soft">
                  We sent a {OTP_LENGTH}-digit verification code by SMS. It expires in 10 minutes.
                </p>

                <div className="mt-5 flex items-center justify-between rounded-control bg-slate-50 border border-line px-4 py-3">
                  <span className="font-semibold tnum">
                    {dial.code} {formatNumber(phone)}
                  </span>
                  <button
                    type="button"
                    className="min-h-[44px] px-2 text-sm font-semibold text-brand-700 hover:underline"
                    onClick={handleEditNumber}
                  >
                    Change
                  </button>
                </div>

                <span className="block mt-6 mb-2 text-sm font-semibold" aria-hidden="true">
                  Verification code
                </span>
                <div
                  className="grid grid-cols-6 gap-2"
                  role="group"
                  aria-label={`${OTP_LENGTH} digit verification code`}
                >
                  {otp.map((digit, index) => (
                    <input
                      // Fixed-length positional inputs: the index is the stable identity.
                      key={`otp-${index}`}
                      ref={(el) => {
                        otpRefs.current[index] = el;
                      }}
                      className={`h-14 w-full text-center text-xl font-semibold tnum rounded-control border bg-white focus:outline-none focus:ring-2 focus:ring-brand-700 focus:border-brand-700 ${
                        otpError
                          ? 'border-emergency-600'
                          : digit
                            ? 'border-brand-700'
                            : index === nextOtpIndex
                              ? 'border-brand-500'
                              : 'border-line'
                      }`}
                      type="text"
                      inputMode="numeric"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      maxLength={OTP_LENGTH}
                      value={digit}
                      onChange={(e) => handleOtpInput(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={handleOtpPaste}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Digit ${index + 1}`}
                    />
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="min-h-[44px] font-semibold text-brand-700 hover:underline"
                    onClick={handleEditNumber}
                  >
                    Wrong number?
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] font-semibold text-brand-700 hover:underline disabled:text-ink-muted disabled:no-underline"
                    onClick={handleResend}
                    disabled={resendIn > 0 || busy}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>

                {error && (
                  <div
                    className="mt-3 flex gap-2 rounded-control bg-emergency-50 border border-emergency-100 p-3 text-sm text-emergency-700"
                    role="alert"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleVerify(otpValue)}
                  disabled={busy}
                  className={`${primaryBtn} mt-5`}
                >
                  <span>{submitLabel()}</span>
                </button>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-line space-y-3 text-sm text-center">
              <p>
                <Link
                  to="/owner/request"
                  className="inline-flex items-center min-h-[44px] font-semibold text-emergency-700 hover:underline"
                >
                  Stranded right now? Skip sign-in
                </Link>
              </p>
              {isOwner ? (
                <p className="text-ink-soft">
                  New vehicle owner?{' '}
                  <Link to="/owner/signup" className="font-semibold text-brand-700 hover:underline">
                    Create an account
                  </Link>
                </p>
              ) : (
                <p className="text-ink-soft">
                  New to the network?{' '}
                  <Link to="/partner/signup" className="font-semibold text-brand-700 hover:underline">
                    Register as a partner
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="py-5 text-xs text-ink-muted text-center">
          By continuing you agree to Sahayak&rsquo;s{' '}
          <Link to="/terms" className="underline hover:text-ink">terms of service</Link> and{' '}
          <Link to="/privacy" className="underline hover:text-ink">privacy policy</Link>.
        </p>
      </main>
    </div>
  );
};

export default LoginPage;
