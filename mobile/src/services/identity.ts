// ─── Sahayak — "Who am I?" ────────────────────────────────────────────────────
//
// The first call after a verified OTP. A Supabase session proves the caller
// controls a phone number and nothing more: it does not say whether Sahayak has a
// profile for that account, which of the three kinds it is, or what our local id
// for it is — and the app cannot route without all three.
//
// Deliberately the same four-outcome union as the web client
// (web/src/services/identity.service.ts). Two clients reading one endpoint should
// agree about what its answers mean, and the three outcomes below lead to three
// different screens — collapsing any two of them strands a real user:
//
//   registered     → into the app, by role
//   needs-signup   → the profile form; the token is valid, there is just no
//                    profile behind it yet
//   needs-linking  → an unclaimed profile is registered to this number. Ops
//                    signed this mechanic up before they ever opened the app.
//
// The backend distinguishes the last two with separate error codes precisely so a
// client can tell them apart (ADR-011). A client that reads only the 403 status
// sends a brand-new owner to a dead end, and sends an ops-registered mechanic
// round a signup form that will reject their number as already taken.
import { AxiosError } from "axios";

import { apiClient } from "./api/client";

export type BackendRole = "user" | "partner" | "admin";

export interface IdentityPayload {
  role: BackendRole;
  id: string;
}

export type IdentityResolution =
  | { kind: "registered"; identity: IdentityPayload }
  | { kind: "needs-signup" }
  | { kind: "needs-linking" }
  /** Network failure, 500, or a 401 the session refresh could not fix. */
  | { kind: "error"; message: string; code?: string };

/** The backend's error envelope: `{ error: { code, message }, request_id }`. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/**
 * Map an HTTP failure onto a routing decision.
 *
 * Exported and pure so it can be tested without a network, a device or a running
 * backend — the branch that matters most (telling the two 403s apart) is one the
 * app takes on a cold path that is easy to get wrong and hard to reach by hand.
 */
export function resolutionFromError(status: number | undefined, code: string | undefined,
                                    message: string): IdentityResolution {
  if (status === 403 && code === "USER_NOT_REGISTERED") return { kind: "needs-signup" };
  if (status === 403 && code === "IDENTITY_NOT_LINKED") return { kind: "needs-linking" };
  return { kind: "error", message, code };
}

/**
 * Words a person can act on, never transport text (N7: a failed call once put a
 * bare "Not Found" on the login screen). The backend's own message is used only
 * when it came in our error envelope with a code; anything else is a proxy,
 * a wrong base URL or the network, and gets a plain sentence.
 */
export function friendlyMessage(status: number | undefined, code: string | undefined,
                                envelopeMessage: string | undefined): string {
  if (status === undefined) return "We could not reach Sahayak. Check your connection and try again.";
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (code && envelopeMessage && status < 500) return envelopeMessage;
  return "Something went wrong on our side. Please try again in a moment.";
}

export const identityService = {
  /**
   * Resolve the stored bearer token to a local profile.
   *
   * Never throws: every caller is a routing decision, and a thrown error there
   * becomes a blank screen rather than a redirect.
   */
  async resolve(): Promise<IdentityResolution> {
    try {
      const res = await apiClient.get<IdentityPayload>("/auth/me");
      return { kind: "registered", identity: res.data };
    } catch (err) {
      const axiosError = err as AxiosError<ErrorEnvelope>;
      const envelope = axiosError.response?.data;
      return resolutionFromError(
        axiosError.response?.status,
        envelope?.error?.code,
        friendlyMessage(axiosError.response?.status, envelope?.error?.code, envelope?.error?.message)
      );
    }
  },
};
