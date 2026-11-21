// ─── Scheduled jobs (ADR-050): pure helpers (same as mobile/src/features/jobs/schedule.ts) ──
// Slots come from GET /jobs/schedule-slots; this file only formats and groups them.
// Labels are India time computed by hand (UTC + 05:30, no daylight saving), so the
// result does not depend on the phone's timezone or on Intl support in Hermes.

export interface ScheduleSlot {
  start: string;
  end: string;
  label: string;
}

const IST_OFFSET_MS = 330 * 60_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

function ist(iso: string): Date {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS);
}

/** "Sun 23 Nov" */
export function dayLabel(iso: string): string {
  const d = ist(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "10:00" */
export function timeLabel(iso: string): string {
  const d = ist(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "Sun 23 Nov, 10:00-12:00", the same shape the server's slot labels use. */
export function slotLabel(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  return `${dayLabel(start)}, ${timeLabel(start)}-${timeLabel(end)}`;
}

/** Slots grouped by India-time day, in order. */
export function groupByDay(slots: ScheduleSlot[]): { day: string; slots: ScheduleSlot[] }[] {
  const out: { day: string; slots: ScheduleSlot[] }[] = [];
  for (const s of slots) {
    const day = dayLabel(s.start);
    const last = out[out.length - 1];
    if (last && last.day === day) last.slots.push(s);
    else out.push({ day, slots: [s] });
  }
  return out;
}
