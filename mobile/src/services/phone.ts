// ─── Sahayak — phone-number shaping ───────────────────────────────────────────
//
// Its own module, with no imports, for the same reason app/utils/phone.py exists
// on the backend: the conversion is needed in two places that must agree, and it
// is the one piece of sign-in logic that can be tested without a device.
//
// supabase.ts re-exports `toE164` so call sites keep importing it from there; this
// file is what the tests import, because supabase.ts pulls in the URL polyfill and
// AsyncStorage and so cannot load outside React Native.

/**
 * A local number plus a dial code, as E.164.
 *
 * Supabase requires E.164 with the leading '+' on the way in. Note that it reports
 * the claim back *without* the '+', which is why the backend compares on digits
 * only (ADR-011) — nothing here needs to care, but the asymmetry is worth knowing
 * before someone "fixes" one side to match the other.
 */
export function toE164(dialCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, "");
  const code = dialCode.replace(/\D/g, "");
  return `+${code}${digits}`;
}
