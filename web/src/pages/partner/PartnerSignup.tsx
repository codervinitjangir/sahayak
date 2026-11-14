import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { serviceIcon } from '../../components/serviceIcon';
import { useServices } from '../../features/jobs/hooks';
import { OtpInput } from './components/OtpInput';
import { StepIndicator } from './components/StepIndicator';
import { partnerService } from '../../services/partner.service';
import { setAuthToken } from '../../services/authToken';
import { identityService } from '../../services/identity.service';
import { IS_SUPABASE_CONFIGURED, getSupabase, sendPhoneOtp, toE164, verifyPhoneOtp } from '../../services/supabase';
import { CATEGORIES, DEFAULT_PARTNER_PROFILE, saveStoredPartnerProfile, type PartnerCategory } from '../../types/partner';
import './partner.css';

const OTP_COUNTDOWN_SECONDS = 30;
const STEPS = ['Phone', 'About you', 'Services'];

/** Fuel delivery is not offered through partner self-registration yet. */
const CATEGORY_CHOICES = CATEGORIES.filter((c) => c.code !== 'fuel_delivery');

const inputClass =
  'w-full min-h-[52px] px-4 bg-white border border-line rounded-control text-base text-ink placeholder:text-ink-muted focus:border-brand-700 focus:ring-2 focus:ring-brand-700 outline-none';

/**
 * Partner registration.
 *
 * Phone (a real SMS code) → name and main category → services → submit. Submitting
 * creates the partner, links it to this login and links the chosen services; the
 * Sahayak team then verifies the account before any job is offered. There is no
 * document upload here: nothing in the product receives files, so asking for them
 * would only imply a review that is not happening.
 */
export const PartnerSignup: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Step 0
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpTimer, setOtpTimer] = useState(OTP_COUNTDOWN_SECONDS);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PartnerCategory | null>(null);

  // Step 2
  const { data: catalogue = [], isLoading: loadingServices, isError: servicesFailed, refetch } = useServices();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (otpSent && otpTimer > 0) {
      timerRef.current = setTimeout(() => setOtpTimer((n) => n - 1), 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [otpSent, otpTimer]);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => navigate('/partner/verification', { replace: true }), 2500);
    return () => clearTimeout(id);
  }, [done, navigate]);

  /**
   * Someone who is already signed in has proved their number; asking for a
   * second code is friction and a second SMS. Reuse the session: a partner goes
   * to the console, a new number starts at "About you". A number that already
   * belongs to an owner stays on the phone step so they can use another one.
   */
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        const session = data.session;
        const verified = session?.user?.phone;
        if (!session?.access_token || !verified || cancelled) return;
        setAuthToken(session.access_token);
        const resolution = await identityService.resolve();
        if (cancelled) return;
        if (resolution.kind === 'registered' && resolution.identity.role === 'partner') {
          navigate('/partner/dashboard', { replace: true });
          return;
        }
        if (resolution.kind === 'registered') return;
        setPhone(verified.replace(/^\+?91/, ''));
        setStep((current) => (current === 0 ? 1 : current));
      } catch {
        // No usable session; the phone step is shown as before.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const phoneDigits = phone.replace(/\D/g, '');

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneDigits.length < 10) {
      setOtpError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!IS_SUPABASE_CONFIGURED) {
      setOtpError('Sign-in is not configured in this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in web/.env.');
      return;
    }
    setOtpError(null);
    setBusy(true);
    const outcome = await sendPhoneOtp(toE164('+91', phone));
    setBusy(false);
    if (!outcome.ok) {
      setOtpError(outcome.message ?? 'Could not send the code. Try again.');
      return;
    }
    setOtpSent(true);
    setOtpTimer(OTP_COUNTDOWN_SECONDS);
  };

  const handleResend = async () => {
    if (otpTimer > 0 || busy) return;
    setOtp('');
    setOtpError(null);
    setBusy(true);
    const outcome = await sendPhoneOtp(toE164('+91', phone));
    setBusy(false);
    if (!outcome.ok) {
      setOtpError(outcome.message ?? 'Could not resend the code. Try again.');
      return;
    }
    setOtpTimer(OTP_COUNTDOWN_SECONDS);
  };

  /**
   * Verifies the code and keeps the token for the final link-auth call. A mechanic
   * who already has a profile goes to the console: ops register many partners by
   * phone before they ever open the app, so that is the common case here.
   */
  const handleVerifyOtp = async () => {
    if (otp.length < 6) {
      setOtpError('Please enter all 6 digits of the code.');
      return;
    }
    setOtpError(null);
    setBusy(true);
    const verified = await verifyPhoneOtp(toE164('+91', phone), otp);
    if (!verified.ok || !verified.accessToken) {
      setBusy(false);
      setOtpError(verified.message ?? 'That code did not work. Try again.');
      return;
    }
    setAuthToken(verified.accessToken);
    const resolution = await identityService.resolve();
    setBusy(false);
    if (resolution.kind === 'registered' && resolution.identity.role === 'partner') {
      navigate('/partner/dashboard', { replace: true });
      return;
    }
    if (resolution.kind === 'registered') {
      setOtpError('This number is already registered as a vehicle owner. Use a different number to sign up as a partner.');
      return;
    }
    setStep(1);
  };

  const toggleService = (code: string) => {
    setSubmitError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const grouped = useMemo(() => {
    const out: Record<string, typeof catalogue> = {};
    for (const s of catalogue) (out[s.category?.name ?? 'Services'] ||= []).push(s);
    return out;
  }, [catalogue]);

  const submit = async () => {
    setSubmitError(null);
    if (selected.size === 0) {
      setSubmitError('Choose at least one service you can provide.');
      return;
    }
    setBusy(true);
    try {
      const cleanName = name.trim();
      const primary = category === 'both' ? 'towing' : (category ?? 'mechanical');
      const reg = await partnerService.registerPartner({
        name: cleanName,
        phone: `+91${phoneDigits}`,
        primary_category_code: primary,
      });
      const partnerId = reg?.id;
      if (!partnerId) throw new Error('Registration did not return a partner id.');

      await partnerService.linkAuth(partnerId);
      const codes = [...selected];
      // The partner exists and is linked at this point; a failure here is not
      // fatal, services can be set again from Preferences.
      await partnerService.updateServices(partnerId, codes).catch(() => undefined);

      saveStoredPartnerProfile({
        ...DEFAULT_PARTNER_PROFILE,
        id: partnerId,
        name: cleanName,
        phone: `+91 ${phoneDigits}`,
        category: category ?? 'mechanical',
        isAvailable: false,
        services: catalogue
          .filter((s) => selected.has(s.code))
          .map((s) => ({ id: s.id, code: s.code, name: s.name, active: true })),
      });
      setDone(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `Could not complete registration: ${err.message}`
          : 'Could not complete registration. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step > 0) setStep((s) => s - 1);
    else navigate('/');
  };

  const header = (
    <header className="bg-white border-b border-line">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" aria-label="Sahayak home">
          <Logo />
        </Link>
        <Link to="/login" className="inline-flex items-center min-h-[44px] text-sm font-semibold text-brand-700 hover:underline">
          Already registered? Sign in
        </Link>
      </div>
    </header>
  );

  if (done) {
    return (
      <div className="min-h-screen bg-canvas">
        {header}
        <main className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="bg-white border border-line rounded-sheet p-8">
            <CheckCircle2 className="w-14 h-14 text-status-success mx-auto" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-bold">You are registered</h1>
            <p className="mt-2 text-ink-soft leading-relaxed">
              The Sahayak team verifies every partner before they can receive jobs. You can check your status any time.
            </p>
            <Link
              to="/partner/verification"
              className="mt-6 inline-flex items-center justify-center min-h-[52px] px-6 rounded-control bg-brand-700 hover:bg-brand-800 text-white font-semibold"
            >
              Check verification status
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {header}
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 bg-white p-4 rounded-card border border-line">
          <StepIndicator steps={STEPS} currentStep={step} />
        </div>

        <div className="bg-white rounded-sheet border border-line p-6 sm:p-8">
          {/* ───── Step 0: phone and code ───── */}
          {step === 0 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {otpSent ? 'Verify your number' : 'Register as a partner'}
              </h1>
              <p className="mt-1 text-ink-soft">
                {otpSent
                  ? `Enter the 6-digit code sent to +91 ${phone}.`
                  : 'Enter your mobile number to register as a service partner.'}
              </p>

              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="mt-6 space-y-5">
                  <div>
                    <label htmlFor="phone-input" className="block text-sm font-semibold mb-2">
                      Mobile number
                    </label>
                    <div className="flex items-stretch border border-line rounded-control overflow-hidden focus-within:border-brand-700 focus-within:ring-2 focus-within:ring-brand-700">
                      <span className="px-4 flex items-center bg-slate-50 border-r border-line font-semibold text-ink-soft">+91</span>
                      <input
                        id="phone-input"
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value.replace(/\D/g, ''));
                          setOtpError(null);
                        }}
                        placeholder="98765 43210"
                        className="flex-1 min-h-[52px] px-4 text-base outline-none tnum"
                        autoFocus
                      />
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">We will text you a 6-digit code. No password needed.</p>
                  </div>

                  {otpError && <ErrorLine text={otpError} />}

                  <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-[200px]" isLoading={busy} disabled={phoneDigits.length < 10}>
                    Send code
                  </Button>
                </form>
              ) : (
                <div className="mt-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Verification code</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSent(false);
                        setOtp('');
                        setOtpError(null);
                      }}
                      className="min-h-[44px] text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Change number
                    </button>
                  </div>
                  <OtpInput value={otp} onChange={setOtp} length={6} />

                  {otpError && <ErrorLine text={otpError} />}

                  <div className="flex items-center justify-between text-sm text-ink-soft">
                    <span>Did not get the code?</span>
                    {otpTimer > 0 ? (
                      <span>
                        Resend in <strong className="tnum">{otpTimer}s</strong>
                      </span>
                    ) : (
                      <button type="button" onClick={handleResend} className="min-h-[44px] font-semibold text-brand-700 hover:underline">
                        Resend code
                      </button>
                    )}
                  </div>

                  <Button size="lg" className="w-full sm:w-auto sm:min-w-[220px]" isLoading={busy} disabled={otp.length < 6} onClick={handleVerifyOtp}>
                    Verify &amp; continue
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ───── Step 1: name and category ───── */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">About you</h1>
              <p className="mt-1 text-ink-soft">This is what owners see when you are matched to their request.</p>

              <div className="mt-6">
                <label htmlFor="partner-name" className="block text-sm font-semibold mb-2">
                  Your name or business name
                </label>
                <input
                  id="partner-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ravi Kumar"
                  autoComplete="name"
                  className={inputClass}
                />
              </div>

              <fieldset className="mt-6">
                <legend className="block text-sm font-semibold mb-2">What is your main work?</legend>
                <div className="grid sm:grid-cols-3 gap-3" role="radiogroup">
                  {CATEGORY_CHOICES.map((c) => {
                    const on = category === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setCategory(c.code)}
                        className={`text-left p-4 rounded-card border-2 min-h-[88px] transition-colors ${
                          on ? 'border-brand-700 bg-brand-50' : 'border-line bg-white hover:border-slate-300'
                        }`}
                      >
                        <span className="block font-semibold">{c.label}</span>
                        <span className="block text-sm text-ink-soft mt-1">{c.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {/* ───── Step 2: services ───── */}
          {step === 2 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Services you provide</h1>
              <p className="mt-1 text-ink-soft">Choose everything you can do. You can change this later.</p>

              <div className="mt-6">
                {loadingServices ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} variant="rectangular" height={60} className="w-full" />
                    ))}
                  </div>
                ) : servicesFailed || catalogue.length === 0 ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" role="alert">
                    <p className="text-emergency-700">We could not load the list of services.</p>
                    <button
                      type="button"
                      onClick={() => void refetch()}
                      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-control border border-line font-semibold hover:bg-slate-50"
                    >
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      Try again
                    </button>
                  </div>
                ) : (
                  Object.entries(grouped).map(([group, items]) => (
                    <fieldset key={group} className="mb-5">
                      <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">{group}</legend>
                      <div className="space-y-3">
                        {items.map((s) => {
                          const Icon = serviceIcon(s.code);
                          const on = selected.has(s.code);
                          return (
                            <label
                              key={s.id}
                              className={`flex items-start gap-3 p-4 rounded-card border-2 cursor-pointer min-h-[64px] transition-colors ${
                                on ? 'border-brand-700 bg-brand-50' : 'border-line bg-white hover:border-slate-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleService(s.code)}
                                className="mt-1 w-5 h-5 accent-[#0F766E]"
                              />
                              <span>
                                <span className="flex items-center gap-2 font-semibold">
                                  <Icon className="w-4 h-4 text-brand-700" aria-hidden="true" />
                                  {s.name}
                                </span>
                                {s.requires_vehicle_equipment && (
                                  <span className="block text-sm text-ink-muted mt-0.5">
                                    Needs equipment verified by Sahayak before you are offered these jobs.
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))
                )}
              </div>

              <p className="mt-2 flex items-start gap-2 text-sm text-ink-soft">
                <ShieldCheck className="w-4 h-4 mt-0.5 text-brand-700 shrink-0" aria-hidden="true" />
                After you register, the Sahayak team verifies your account. You receive jobs once it is verified.
              </p>

              {submitError && (
                <div className="mt-4">
                  <ErrorLine text={submitError} />
                </div>
              )}
            </div>
          )}

          {/* Footer navigation for steps 1 and 2 */}
          {step > 0 && (
            <div className="mt-8 pt-5 border-t border-line flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={back}
                disabled={busy}
                className="inline-flex items-center gap-1.5 min-h-[48px] px-3 font-semibold text-ink-soft hover:text-ink"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back
              </button>
              {step === 1 ? (
                <Button size="lg" disabled={name.trim().length < 2 || !category} onClick={() => setStep(2)}>
                  Continue
                </Button>
              ) : (
                <Button size="lg" isLoading={busy} disabled={selected.size === 0} onClick={submit}>
                  Register
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const ErrorLine: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="flex items-start gap-2 text-sm text-emergency-700 bg-emergency-50 p-3 rounded-control border border-emergency-100"
    role="alert"
  >
    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
    <span>{text}</span>
  </div>
);

export default PartnerSignup;
