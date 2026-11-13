import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { usersService } from '../../services/users.service';
import { useAuth } from '../../app/AuthProvider';
import { getAuthToken } from '../../services/authToken';
import { getSupabase, IS_SUPABASE_CONFIGURED } from '../../services/supabase';
import { Button } from '../../components/ui/Button';

export const OwnerSignup: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  // Same-site owner paths only: never an open redirect.
  const redirectPath =
    rawRedirect && rawRedirect.startsWith('/owner') && !rawRedirect.startsWith('//') && !rawRedirect.includes('://')
      ? rawRedirect
      : '/owner';
  const { setRole } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * `POST /api/v1/users` is authenticated: it creates the profile *and* binds it
   * to the caller's Supabase account in one step, so the token has to exist
   * before the form is submitted. Reaching this page without one is not a state
   * the form can recover from — the only outcome would be a 401 after the user
   * has typed everything — so send them to sign in first and come back.
   */
  useEffect(() => {
    if (!getAuthToken()) {
      navigate(`/login?redirect=${encodeURIComponent(`/owner/signup?redirect=${redirectPath}`)}`, {
        replace: true,
      });
    }
  }, [navigate, redirectPath]);

  /**
   * Prefill the number the token already proves.
   *
   * The backend sets `phone_verified` from the token's phone claim, not from this
   * field, so a user who types a different number here gets a profile whose phone
   * is silently unverified. Prefilling makes the common case correct and the
   * mismatch visible.
   */
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) return;
    void getSupabase()
      .auth.getUser()
      .then(({ data }) => {
        const verified = data.user?.phone;
        if (verified) setPhone(verified.replace(/^(\+?91)/, ''));
      })
      .catch(() => {
        // Nothing to prefill; the user types it as before.
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/\D/g, '');

    if (!cleanName || cleanName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setIsSubmitting(true);
    try {
      await usersService.createUser({
        name: cleanName,
        phone: `+91${cleanPhone}`,
        email: email.trim() || undefined,
        role: 'owner',
      });

      setRole('owner');
      navigate(redirectPath, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const input =
    'w-full min-h-[52px] px-4 bg-white border border-line rounded-control text-base text-ink placeholder:text-ink-muted focus:border-brand-700 focus:ring-2 focus:ring-brand-700 outline-none';

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <header className="bg-white border-b border-line">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" aria-label="Sahayak home">
            <Logo />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-ink-soft hover:text-ink">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to site
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-2 text-ink-soft">Your number is verified. Add your name so partners know who they are helping.</p>

        <div className="mt-6 bg-white border border-line rounded-sheet p-6">
          {error && (
            <div role="alert" className="mb-5 p-3 bg-emergency-50 border border-emergency-100 rounded-control flex items-start gap-2 text-emergency-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="owner-name" className="block text-sm font-semibold mb-1.5">
                Full name
              </label>
              <input
                id="owner-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Asha Sharma"
                autoComplete="name"
                className={input}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="owner-phone" className="block text-sm font-semibold mb-1.5">
                Mobile number
              </label>
              <div className="flex items-stretch border border-line rounded-control overflow-hidden focus-within:border-brand-700 focus-within:ring-2 focus-within:ring-brand-700">
                <span className="px-4 flex items-center bg-slate-50 border-r border-line font-semibold text-ink-soft">+91</span>
                <input
                  id="owner-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98765 43210"
                  autoComplete="tel-national"
                  className="flex-1 min-h-[52px] px-4 text-base outline-none tnum"
                />
              </div>
            </div>

            <div>
              <label htmlFor="owner-email" className="block text-sm font-semibold mb-1.5">
                Email <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="owner-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={input}
              />
            </div>

            <Button type="submit" size="lg" isLoading={isSubmitting} className="w-full">
              Create account
            </Button>
          </form>

          <p className="mt-5 flex items-start gap-2 text-sm text-ink-soft">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-brand-700 shrink-0" aria-hidden="true" />
            A partner sees your phone number only after they are assigned to your request.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
};

export default OwnerSignup;
