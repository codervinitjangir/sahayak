import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import i18n, { bookingError } from "../../src/i18n";
import en from "../../src/i18n/locales/en.json";

// ADR-052: translation groundwork. English only; these guard the catalogue.
const SRC = join(__dirname, "..", "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function flat(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

const used = new Set(
  files(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bt\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)].map((m) => m[1])),
);
const keys = flat(en);

describe("translation catalogue", () => {
  it("is initialised in English on import", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe("en");
    expect(i18n.t("booking.leadNote", { min: 45 })).toContain("45 minutes before your slot");
  });

  it("every key a screen uses exists", () => {
    expect([...used].filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("every key in the catalogue is used (error codes are looked up by code)", () => {
    expect(keys.filter((k) => !used.has(k) && !k.startsWith("booking.errors."))).toEqual([]);
  });

  it("maps booking error codes, and nothing else", () => {
    expect(bookingError("TOO_MANY_SCHEDULED_JOBS")).toMatch(/three upcoming bookings/);
    expect(bookingError("JOB_NOT_FOUND")).toBeUndefined();
    expect(bookingError(undefined)).toBeUndefined();
  });
});
