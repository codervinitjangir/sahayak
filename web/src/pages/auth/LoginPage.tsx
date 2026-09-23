import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Check,
  Globe,
} from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import './auth.css';

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

const SEEDED_NUMBER: Record<LoginRole, string> = {
  owner: '9876543210',
  partner: '9811122334',
};



/** Groups a national number for readability: 98765 43210. */
function formatNumber(digits: string): string {
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const IndiaFlag: React.FC = () => (
  <svg className="auth-dial__flag" viewBox="0 0 640 480" aria-hidden="true">
    <path fill="#FF9933" d="M0 0h640v160H0z" />
    <path fill="#FFFFFF" d="M0 160h640v160H0z" />
    <path fill="#138808" d="M0 320h640v160H0z" />
    <circle cx="320" cy="240" r="42" fill="#000080" />
    <circle cx="320" cy="240" r="33" fill="#FFFFFF" />
    <circle cx="320" cy="240" r="11" fill="#000080" />
  </svg>
);



export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { setRole } = useAuth();

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

  const goToRole = useCallback(
    (target: LoginRole) => {
      setRole(target);
      navigate(target === 'owner' ? '/owner' : '/partner/preferences', { replace: true });
    },
    [navigate, setRole]
  );

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
   * Step 1 → 2. The button reports its own progress by label, so the card
   * never swaps out under the user and nothing on the page has to spin.
   */
  const handleSendCode = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!phoneComplete) {
      setError(`Enter your ${dial.digits}-digit mobile number to continue.`);
      return;
    }

    setError(null);
    setStatus('sending');

    defer(() => {
      setStatus('sent');
      defer(() => {
        setStep('verify');
        setStatus('idle');
        setResendIn(RESEND_SECONDS);
        defer(() => otpRefs.current[0]?.focus(), 60);
      }, 420);
    }, 620);
  };

  const handleVerify = useCallback(
    (code: string) => {
      if (code.length < OTP_LENGTH) {
        setOtpError(true);
        setError('Enter all six digits of the code we sent you.');
        return;
      }
      setError(null);
      setStatus('sending');
      defer(() => goToRole(loginRole), 500);
    },
    [defer, goToRole, loginRole]
  );

  // Auto-submit the moment the sixth digit lands — no extra tap on a roadside.
  useEffect(() => {
    if (step === 'verify' && otpValue.length === OTP_LENGTH && status === 'idle') {
      handleVerify(otpValue);
    }
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

  const handleResend = () => {
    if (resendIn > 0) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setError(null);
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

  return (
    <div className="auth-root">
      <div className="auth-shell">
        {/* ── Left: editorial panel ─────────────────────────────────────── */}
        <aside className="auth-panel">
          <div className="auth-panel__ring" aria-hidden="true" />

          <h2 className="auth-panel__headline">
            Every second on the roadside
            <br />
            feels longer than it is.
          </h2>

          <p className="auth-panel__subhead">
            Verified partners, dispatched in minutes &mdash; not &ldquo;eventually.&rdquo;
          </p>

          {/* Static product mock, cropped by the panel edge */}
          <div className="auth-mock" aria-hidden="true">
            <div className="auth-mock__screen">
              <span className="auth-mock__status">
                <span className="auth-mock__dot" />
                Partner en route
              </span>

              <div className="auth-mock__eta">
                14<span>min away</span>
              </div>
              <p className="auth-mock__label">Flat-tyre support · Indiranagar 100ft Rd</p>

              <div className="auth-mock__track">
                <i />
              </div>

              <div className="auth-mock__partner">
                <span className="auth-mock__avatar">RK</span>
                <div>
                  <div className="auth-mock__name">Ramesh Kumar</div>
                  <div className="auth-mock__meta">Speedy Mechanics · 4.9 ★</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Right: form panel ─────────────────────────────────────────── */}
        <main className="auth-form-panel">
          <div className="auth-topbar">
            <Link to="/" className="auth-wordmark">
              <span className="auth-wordmark__text">Sahayak</span>
            </Link>

            <Link to="/" className="auth-toplink">
              <ArrowLeft className="w-[13px] h-[13px]" />
              <span>Back to site</span>
            </Link>
          </div>

          <div className="auth-body">
            {!onVerifyStep ? (
              <div>
                <h1 className="auth-title">
                  {isOwner ? 'Get roadside help' : 'Partner dispatch console'}
                </h1>
                <p className="auth-desc">
                  {isOwner
                    ? 'Sign in to request help or manage your vehicles.'
                    : 'Sign in to accept jobs and set your dispatch preferences.'}
                </p>

                {/* Context first — who you are changes where you land. Text
                    only: glyphs inside a segmented control add noise, not
                    meaning, when both options are two plain words. */}
                <div
                  className={`auth-roles ${loginRole === 'partner' ? 'auth-roles--partner' : ''}`}
                  role="radiogroup"
                  aria-label="Choose account type"
                >
                  <span className="auth-roles__thumb" aria-hidden="true" />
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isOwner}
                    onClick={() => handleRoleChange('owner')}
                    className={`auth-role ${isOwner ? 'auth-role--active' : ''}`}
                  >
                    Vehicle Owner
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!isOwner}
                    onClick={() => handleRoleChange('partner')}
                    className={`auth-role ${!isOwner ? 'auth-role--active' : ''}`}
                  >
                    Service Partner
                  </button>
                </div>

                <form onSubmit={handleSendCode}>
                  <label htmlFor="auth-phone" className="auth-label">
                    Mobile number
                  </label>
                  <div
                    className={`auth-field ${error && !phoneComplete ? 'auth-field--invalid' : ''}`}
                  >
                    <div className="auth-dial">
                      {dial.iso === 'IN' ? <IndiaFlag /> : <Globe className="w-[15px] h-[15px]" />}
                      <span>{dial.code}</span>
                      <select
                        className="auth-dial__select"
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
                            {d.label} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <span className="auth-field__rule" aria-hidden="true" />

                    <input
                      id="auth-phone"
                      className="auth-field__input"
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

                  <p className="auth-trust-line">
                    No password needed. We&rsquo;ll text you a 6-digit code.
                  </p>

                  {error && (
                    <div className="auth-error" role="alert">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!phoneComplete || busy}
                    className={`auth-submit ${busy ? 'auth-submit--busy' : ''}`}
                  >
                    {status === 'sent' && <Check className="w-[17px] h-[17px]" />}
                    <span>{submitLabel()}</span>
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <h1 className="auth-title">Enter your code</h1>
                <p className="auth-desc">
                  We sent a {OTP_LENGTH}-digit verification code by SMS. It expires in 10 minutes.
                </p>

                {/* Always show which number this code went to */}
                <div className="auth-identity">
                  <span className="auth-identity__num">
                    {dial.code} {formatNumber(phone)}
                  </span>
                  <button
                    type="button"
                    className="auth-identity__change"
                    onClick={handleEditNumber}
                  >
                    Change
                  </button>
                </div>

                {/* Visual only — the group below already carries the real name. */}
                <span className="auth-label" aria-hidden="true">
                  Verification code
                </span>
                <div
                  className={`auth-otp ${otpError ? 'auth-otp--error' : ''}`}
                  role="group"
                  aria-label={`${OTP_LENGTH} digit verification code`}
                >
                  {otp.map((digit, index) => (
                    <input
                      // Fixed-length positional inputs — index is the stable identity.
                      key={`otp-${index}`}
                      ref={(el) => {
                        otpRefs.current[index] = el;
                      }}
                      className={[
                        'auth-otp__box',
                        digit ? 'auth-otp__box--filled' : '',
                        index === nextOtpIndex ? 'auth-otp__box--next' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
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

                <div className="auth-helper">
                  <button type="button" className="auth-linkbtn" onClick={handleEditNumber}>
                    Wrong number?
                  </button>
                  <button
                    type="button"
                    className="auth-linkbtn"
                    onClick={handleResend}
                    disabled={resendIn > 0}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>

                {error && (
                  <div className="auth-error" role="alert">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleVerify(otpValue)}
                  disabled={busy}
                  className={`auth-submit ${busy ? 'auth-submit--busy' : ''}`}
                >
                  <span>{submitLabel()}</span>
                </button>
              </div>
            )}

            <p className="auth-emergency-link">
              <Link to="/owner/request">Stranded right now? Skip sign-in</Link>
            </p>



            {isOwner ? (
              <p className="auth-partner-cta">
                New vehicle owner?
                <Link to="/owner/signup">Create an account</Link>
              </p>
            ) : (
              <p className="auth-partner-cta">
                New to the network?
                <Link to="/partner/signup">Register as a partner</Link>
              </p>
            )}
          </div>

          <div className="auth-foot">
            <p className="auth-legal">
              By continuing you agree to Sahayak's <a href="#terms">Terms of Service</a> and{' '}
              <a href="#privacy">Privacy Policy</a>.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default LoginPage;
