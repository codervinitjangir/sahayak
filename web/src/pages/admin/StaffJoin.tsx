import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../app/AuthProvider';
import { ApiError } from '../../services/api';
import { adminService } from '../../services/admin.service';
import { setAuthToken } from '../../services/authToken';
import { IS_SUPABASE_CONFIGURED, getSupabase } from '../../services/supabase';

/** Set before sending an invitee to /login, so login returns them here instead of to owner signup. */
export const STAFF_JOIN_FLAG = 'sahayak_staff_join';

/**
 * Where an invited staff member turns an invite code into an account (ADR-029).
 *
 * The code is pasted, never carried in the URL: a link with the code in it would
 * sit in browser history and server logs. The server also requires the signed-in
 * number to be the invited one, so the code alone is not enough.
 */
export const StaffJoin: React.FC = () => {
  const navigate = useNavigate();
  const { setRole } = useAuth();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) {
      setSignedIn(false);
      return;
    }
    let cancelled = false;
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session?.access_token) setAuthToken(data.session.access_token);
        setSignedIn(Boolean(data.session?.access_token));
      })
      .catch(() => !cancelled && setSignedIn(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const goSignIn = () => {
    try {
      sessionStorage.setItem(STAFF_JOIN_FLAG, '1');
    } catch {
      // Without storage the invitee comes back here by hand after signing in.
    }
    navigate('/login');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminService.acceptInvite(code.trim());
      try {
        sessionStorage.removeItem(STAFF_JOIN_FLAG);
      } catch {
        // nothing to clear
      }
      setRole('ops');
      navigate('/admin/jobs', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'INVITE_INVALID'
            ? 'This code is not valid for the number you signed in with. Check that you signed in with the invited number, or ask for a new code.'
            : err.code === 'AUTH_ALREADY_LINKED'
              ? 'This number already has a Sahayak owner or partner profile. Staff accounts need a number of their own.'
              : err.message
          : 'Could not reach Sahayak. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FA]">
      <header className="bg-white border-b border-line">
        <div className="max-w-xl mx-auto px-4 h-16 flex items-center">
          <Link to="/" aria-label="Sahayak home">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-white border border-line rounded-card p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 text-brand-700">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-wide">Staff access</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Join the Sahayak team</h1>

          {signedIn === null ? (
            <p className="text-sm text-ink-soft">Checking your sign-in…</p>
          ) : !signedIn ? (
            <>
              <p className="text-sm text-ink-soft">
                First sign in with the mobile number your invite was sent for. You will come back here to enter the code.
              </p>
              <Button size="lg" onClick={goSignIn}>Sign in with the invited number</Button>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label htmlFor="invite-code" className="block text-sm font-semibold text-ink">
                Invite code
              </label>
              <input
                id="invite-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full min-h-[48px] px-3 border border-line rounded-control text-sm font-mono"
              />
              <p className="text-xs text-ink-soft">
                The code works once, for 72 hours, and only for the number it was issued to.
              </p>
              {error && <p role="alert" className="text-sm text-emergency-700 font-medium">{error}</p>}
              <Button type="submit" size="lg" isLoading={busy} disabled={code.trim().length < 20}>
                Activate staff account
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
