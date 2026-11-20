// ─── Sahayak: crash reporting (ADR-037) ───────────────────────────────────────
// Posts a crash to POST /api/v1/client-errors, which writes one log line on the
// server. No vendor SDK and no account. No user id, phone or token is sent.
// At most one report per message every 30 s, so a render loop cannot flood the
// endpoint, which rate-limits per address anyway.

import { Platform } from "react-native";
import { API_BASE_URL } from "../constants";

const SEEN = new Map<string, number>();
const DEDUPE_MS = 30_000;

export interface CrashReport {
  platform: "android" | "ios" | "web";
  message: string;
  stack?: string;
  component_stack?: string;
}

export function buildCrashReport(error: unknown, componentStack?: string | null): CrashReport {
  const err = error instanceof Error ? error : null;
  const os = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
  const report: CrashReport = {
    platform: os,
    message: (err ? `${err.name}: ${err.message}` : String(error)).slice(0, 2000) || "Unknown error",
  };
  if (err?.stack) report.stack = err.stack.slice(0, 4000);
  if (componentStack) report.component_stack = componentStack.slice(0, 2000);
  return report;
}

export function reportCrash(
  error: unknown,
  componentStack?: string | null,
  send: typeof fetch = fetch,
  now: number = Date.now(),
): boolean {
  try {
    const report = buildCrashReport(error, componentStack);
    const last = SEEN.get(report.message);
    if (last !== undefined && now - last < DEDUPE_MS) return false;
    SEEN.set(report.message, now);
    void send(`${API_BASE_URL}/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => undefined);
    return true;
  } catch {
    return false; // reporting must never be the second failure
  }
}

/** Catch errors outside React's tree (event handlers, promises in RN's global handler). */
export function installGlobalCrashHandler(): void {
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const eu = g.ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((e, fatal) => {
    reportCrash(e);
    previous(e, fatal);
  });
}
