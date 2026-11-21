// Sahayak Care (ADR-051): types and wording shared by every screen that shows it.
// Dates are India time (UTC+05:30) whatever the device's timezone, like ADR-050.
// Month names stay English until a second language ships (ADR-052).
import i18n from '../../i18n';

export interface CareMembership {
  id: string;
  plan_code: string;
  plan_name: string;
  starts_at: string;
  ends_at: string;
  callouts_allowed: number;
  callouts_used: number;
  callouts_left: number;
  active: boolean;
  revoked_at?: string | null;
  revoke_reason?: string | null;
}

export interface CarePlan {
  code: string;
  name: string;
  callouts: number;
  term_days: number;
}

export interface MyCare {
  membership: CareMembership | null;
  plans: CarePlan[];
  /** The server's honest line: covered call-outs cost the same until billing starts. */
  pricing_note: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function careDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function calloutsLine(m: Pick<CareMembership, "callouts_left" | "callouts_allowed">): string {
  return i18n.t("care.calloutsLeft", { left: m.callouts_left, allowed: m.callouts_allowed });
}
