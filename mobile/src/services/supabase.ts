// ─── Sahayak — Supabase Auth (mobile) ─────────────────────────────────────────
//
// The only thing in this app that produces a token. Sahayak's backend verifies
// Supabase access tokens against the project's JWKS and never mints its own, so a
// phone OTP against Supabase is the whole authentication story and the
// `access_token` it returns is what every `Authorization: Bearer` header carries.
//
// Until 2026-10-07 this file did not exist. `authApi.sendOTP` returned
// `{success: true}` without calling anything, `authApi.verifyOTP` accepted any six
// digits and handed back an unverified token, and the login screen
// pre-filled the code boxes with 123456. Nothing produced a real token, so every
// authenticated endpoint answered 401 — the screens only worked because the
// service layer was isolated too.
//
// ## Three things differ from the web implementation
//
//  1. `react-native-url-polyfill/auto` is imported *first*. supabase-js builds
//     request URLs with the WHATWG `URL` API, which React Native's Hermes runtime
//     does not implement. Without the polyfill every auth call fails with
//     "URL.protocol is not implemented" — at runtime only, so a typecheck and a
//     bundle both pass and the failure appears on a device.
//  2. `storage: AsyncStorage`. The web client defaults to `localStorage`, which
//     does not exist here; with no storage the session lives in memory and a
//     mechanic who backgrounds the app long enough for it to be killed is back at
//     the OTP screen.
//  3. Config comes from `EXPO_PUBLIC_*` env vars, which Expo inlines at build
//     time.
//
// ## Why the publishable key is not a leak
//
// It identifies the project to its public auth endpoints, is designed to ship
// inside a client bundle, and grants nothing on its own — row-level security and
// our own JWT checks decide what a request may do. The *secret* key bypasses all
// of that and lives only in backend/.env. A `sb_secret_...` value in a mobile
// bundle would be readable by anyone who downloads the app.
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Whether real sign-in is possible in this build.
 *
 * Checked rather than assumed because the failure it prevents reads like a
 * backend outage: with no URL and no key `createClient` still constructs happily
 * and every auth call fails later with a network error. The login screen reads
 * this and says what is actually wrong.
 */
export const IS_SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!IS_SUPABASE_CONFIGURED) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and " +
        "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env (see .env.example)."
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        // No OAuth provider is enabled on this project, and a mobile client has no
        // URL fragment to read a session out of anyway.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

// Re-exported so call sites have one import for the sign-in surface. It lives in
// phone.ts because that module has no imports and so can be tested outside React
// Native — this file cannot, since it pulls in the URL polyfill and AsyncStorage.
export { toE164 } from "./phone";

export interface OtpOutcome {
  ok: boolean;
  /** Present when `ok` is false — safe to show the user as-is. */
  message?: string;
}

/**
 * Ask Supabase to send a verification code to `phone` (E.164).
 *
 * `shouldCreateUser` stays at its default of true: a mechanic onboarded by ops
 * exists in our `partners` table long before they have a Supabase account, and an
 * owner signing up has no account either. Refusing to create one would make first
 * launch impossible for both.
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
      type: "sms",
    });
    if (error) return { ok: false, message: describeAuthError(error.message) };

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      // Defensive: verifyOtp resolving without a session should not happen, and
      // returning ok here would store `undefined` as the bearer, turning a clear
      // failure into 401s on every later call.
      return { ok: false, message: "Verification succeeded but no session was returned." };
    }
    return { ok: true, accessToken };
  } catch (err) {
    return { ok: false, message: describeAuthError((err as Error).message) };
  }
}

/** The current access token, refreshed if it is close to expiry. */
export async function getFreshAccessToken(): Promise<string | null> {
  if (!IS_SUPABASE_CONFIGURED) return null;
  try {
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
    // Already signed out, or offline. The local token is cleared by the caller
    // either way, so there is nothing to recover from here.
  }
}

/**
 * Turn Supabase's wording into something a stranded driver can act on.
 *
 * Only the cases a user can actually hit are rewritten; anything else passes
 * through rather than being replaced by a generic apology that hides the cause.
 */
function describeAuthError(message: string): string {
  const text = (message || "").toLowerCase();

  if (text.includes("phone") && (text.includes("disabled") || text.includes("not enabled"))) {
    return "Phone sign-in is turned off for this project. Enable the phone provider in the Supabase dashboard.";
  }
  if (text.includes("invalid") && text.includes("token")) {
    return "That code is not right. Check the digits, or ask for a new code.";
  }
  if (text.includes("expired")) {
    return "That code has expired. Request a new one.";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many attempts. Wait a minute before asking for another code.";
  }
  if (text.includes("504") || text.includes("gateway") || text.includes("timeout")) {
    return "SMS provider timed out (504). Real carrier SMS is not configured in Supabase. Please use test number 9000000901 (Code: 123456) or Developer Quick Login.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  return message || "Sign-in failed. Try again.";
}
