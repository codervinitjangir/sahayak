/**
 * Sign-in logic that can be tested without a device.
 *
 * Mobile has no React Native test runner — adding jest-expo to assert on screens
 * is a much larger change than this task — so the parts worth protecting were
 * written as pure functions and are covered here: the phone shaping Supabase
 * requires on the way in, and the fork that decides where a verified account goes
 * next. The screen wiring is covered by `tsc --noEmit` and by hand.
 *
 * The routing fork is the piece that most repays a test. Its three outcomes lead
 * to three different screens, two of them arrive as the *same* HTTP status (403),
 * and the branches are reached only on cold paths — a first-ever sign-in, or a
 * mechanic whom ops registered before they installed the app. Those are precisely
 * the cases nobody exercises by tapping through, and getting them wrong strands a
 * real user: send a new owner to "contact support", or send an ops-registered
 * mechanic round a signup form that will reject their number as taken.
 *
 * `./api/client` is mocked because importing it pulls in `src/constants`, which
 * reads React Native's `__DEV__` global and does not exist under Node.
 */
import { describe, expect, it, vi } from "vitest";

import { friendlyMessage, resolutionFromError } from "../src/services/identity";
import { toE164 } from "../src/services/phone";

vi.mock("../src/services/api/client", () => ({
  apiClient: { get: vi.fn() },
}));

describe("toE164", () => {
  it("joins a dial code and a local number into what Supabase expects", () => {
    expect(toE164("+91", "9876543210")).toBe("+919876543210");
  });

  it("strips the spaces a human types", () => {
    expect(toE164("+91", "98765 43210")).toBe("+919876543210");
  });

  it("tolerates a dial code given without its plus", () => {
    expect(toE164("91", "9876543210")).toBe("+919876543210");
  });

  it("keeps the leading plus Supabase requires on the way in", () => {
    // The asymmetry worth remembering: Supabase wants '+' on input and reports the
    // claim back without it, which is why the backend compares on digits only.
    expect(toE164("+91", "9876543210").startsWith("+")).toBe(true);
  });
});

describe("resolutionFromError", () => {
  it("routes USER_NOT_REGISTERED to signup", () => {
    // Verified by Supabase, unknown to us. The token is valid, so retrying the OTP
    // would loop forever — only a signup step escapes it.
    expect(resolutionFromError(403, "USER_NOT_REGISTERED", "no profile")).toEqual({
      kind: "needs-signup",
    });
  });

  it("routes IDENTITY_NOT_LINKED to linking, not signup", () => {
    // An unclaimed profile exists for this number — ops registered this mechanic
    // already. Sending them to signup fails on a duplicate phone.
    expect(resolutionFromError(403, "IDENTITY_NOT_LINKED", "not linked")).toEqual({
      kind: "needs-linking",
    });
  });

  it("tells the two 403s apart rather than reading the status alone", () => {
    const signup = resolutionFromError(403, "USER_NOT_REGISTERED", "x");
    const linking = resolutionFromError(403, "IDENTITY_NOT_LINKED", "x");
    expect(signup.kind).not.toBe(linking.kind);
  });

  it("treats a 403 with no code as an error, not as a signup prompt", () => {
    // Guessing "needs-signup" from the status would send a mechanic who hit some
    // other forbidden case into an owner signup form.
    const result = resolutionFromError(403, undefined, "Forbidden");
    expect(result.kind).toBe("error");
  });

  it("treats a 401 as an error — the caller decides to re-authenticate", () => {
    expect(resolutionFromError(401, "UNAUTHORIZED", "bad token").kind).toBe("error");
  });

  it("treats a 500 as an error and keeps the message", () => {
    const result = resolutionFromError(500, "INTERNAL_ERROR", "Could not read identity");
    expect(result).toMatchObject({ kind: "error", message: "Could not read identity" });
  });

  it("treats a network failure with no status as an error", () => {
    expect(resolutionFromError(undefined, undefined, "Network Error").kind).toBe("error");
  });

  it("does not mistake a non-403 USER_NOT_REGISTERED for a signup prompt", () => {
    // Pinned deliberately: the code is matched together with the status, so a
    // future endpoint returning that string with a different status cannot
    // accidentally reroute sign-in.
    expect(resolutionFromError(400, "USER_NOT_REGISTERED", "x").kind).toBe("error");
  });
});

describe("friendlyMessage (N7)", () => {
  it("never shows transport text for a response without our envelope", () => {
    const msg = friendlyMessage(404, undefined, undefined);
    expect(msg).not.toMatch(/not found/i);
    expect(msg).toMatch(/try again/i);
  });

  it("names the connection when there was no response at all", () => {
    expect(friendlyMessage(undefined, undefined, undefined)).toMatch(/connection/i);
  });

  it("keeps the backend's own sentence when it came with an error code", () => {
    expect(friendlyMessage(409, "PHONE_ALREADY_REGISTERED", "This number is already registered."))
      .toBe("This number is already registered.");
  });

  it("does not repeat a server-side failure message", () => {
    expect(friendlyMessage(500, "INTERNAL_ERROR", "Could not read identity")).not.toMatch(/identity/i);
  });
});
