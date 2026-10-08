/**
 * The Supabase Auth client — the only thing in this app that issues a token.
 *
 * Sahayak's backend verifies Supabase access tokens and never mints its own: it
 * fetches the project's JWKS and checks the ES256 signature on every request
 * (see backend/app/services/auth_service.py). So there is no `POST /login` to
 * call and no password for us to hold. A phone OTP verified against Supabase is
 * the entire authentication story, and the `access_token` it returns is what
 * every `Authorization: Bearer` header in this app carries.
 *
 * Until 2026-10-06 this file did not exist. `LoginPage` advanced its own step
 * state on a timer and navigated, which looked exactly like a successful sign-in
 * and produced no token at all — so every authenticated endpoint answered 401
 * and the only screens that worked were the ones backed by a mock.
 *
 * ## Why the key in `VITE_SUPABASE_PUBLISHABLE_KEY` is not a leak
 *
 * Supabase issues two keys. The publishable key identifies the project to its
 * public auth and REST endpoints and is designed to sit in a browser bundle; it
 * grants nothing on its own, because row-level security and our own JWT checks
 * decide what a request may do. The *secret* key bypasses all of that and lives
 * only in `backend/.env`. If you ever find a `sb_secret_...` value in this
 * directory, that is the bug.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * Whether real sign-in is possible in this build.
 *
 * Checked rather than assumed because the failure it prevents is confusing: with
 * no URL and no key, `createClient` still constructs happily and every auth call
 * fails later with a network error that reads like the backend is down. The
 * login screen reads this flag and says what is actually wrong.
 */
export const IS_SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/**
 * One client for the process. Created lazily so a build without the env vars can
 * still render — the login screen needs to be able to explain the misconfiguration
 * rather than crash on import.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!IS_SUPABASE_CONFIGURED) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_PUBLISHABLE_KEY in web/.env (copy web/.env.example).'
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        // Supabase keeps the session in localStorage and refreshes the access
        // token before it expires. Both are on by default; they are named here
        // because this app depends on them. Tokens are short-lived, so without
        // autoRefreshToken a mechanic on a long job would start getting 401s
        // mid-shift, and without persistSession a page reload on a roadside
        // would drop them back to the OTP screen.
        persistSession: true,
        autoRefreshToken: true,
        // No OAuth provider is enabled on this project, so there is never a
        // token in the URL fragment to pick up.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Normalises a local 10-digit Indian number and a dial code into E.164. */
export function toE164(dialCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, '');
  const code = dialCode.replace(/\D/g, '');
  return `+${code}${digits}`;
}

export interface OtpOutcome {
  ok: boolean;
  /** Present when `ok` is false — safe to show to the user as-is. */
  message?: string;
}

/**
 * Ask Supabase to send a verification code to `phone` (E.164).
 *
 * `shouldCreateUser` is left at its default of true: a mechanic onboarded by ops
 * exists in our `partners` table long before they have a Supabase account, and
 * an owner signing up has no account either. Refusing to create one would make
 * first launch impossible for both.
 */
export async function sendPhoneOtp(phone: string): Promise<OtpOutcome> {
  try {
    const { error } = await getSupabase().auth.signInWithOtp({ phone });
    if (error) return { ok: false, message: describeAuthError(error.message) };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describeAuthError((err as Error).message) };
  }
}

export interface VerifyOutcome extends OtpOutcome {
  /** The backend bearer token. Present only when `ok` is true. */
  accessToken?: string;
}

/** Exchange the six-digit code for a session. */
export async function verifyPhoneOtp(phone: string, code: string): Promise<VerifyOutcome> {
  try {
    const { data, error } = await getSupabase().auth.verifyOtp({
      phone,
      token: code,
      type: 'sms',
    });
    if (error) return { ok: false, message: describeAuthError(error.message) };

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      // Defensive: verifyOtp resolving without a session should not happen, but
      // returning ok here would store `undefined` as the bearer token and turn
      // a clear failure into 401s on every later call.
      return { ok: false, message: 'Verification succeeded but no session was returned.' };
    }
    return { ok: true, accessToken };
  } catch (err) {
    return { ok: false, message: describeAuthError((err as Error).message) };
  }
}

/** The current access token, or null when nobody is signed in. */
export async function getFreshAccessToken(): Promise<string | null> {
  if (!IS_SUPABASE_CONFIGURED) return null;
  try {
    // getSession() refreshes the token when it is close to expiry, which is the
    // reason to prefer it over reading the stored value directly.
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (!IS_SUPABASE_CONFIGURED) return;
  try {
    await getSupabase().auth.signOut();
  } catch {
    // Already signed out, or offline. The local token is cleared either way by
    // the caller, so there is nothing to recover from here.
  }
}

/**
 * Turn Supabase's wording into something a stranded driver can act on.
 *
 * Only the cases a user can actually hit are rewritten; anything else is passed
 * through rather than replaced by a generic apology that hides the cause.
 */
function describeAuthError(message: string): string {
  const text = (message || '').toLowerCase();

  if (text.includes('phone') && (text.includes('disabled') || text.includes('not enabled'))) {
    return 'Phone sign-in is turned off for this project. Enable the phone provider in the Supabase dashboard.';
  }
  if (text.includes('invalid') && text.includes('token')) {
    return 'That code is not right. Check the digits, or ask for a new code.';
  }
  if (text.includes('expired')) {
    return 'That code has expired. Request a new one.';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Wait a minute before asking for another code.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return message || 'Sign-in failed. Try again.';
}
