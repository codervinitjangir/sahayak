import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Guard against another company's brand creeping back into the app. The mobile UI
 * was once a copy of a grocery-delivery app (its name, palette and font); that
 * cannot ship, so this fails the build if it returns.
 */
const SRC = join(__dirname, "..", "src");
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "third-party brand name", re: /\b(blinkit|zomato|zepto|swiggy|citilink)\b/i },
  { name: "former brand yellow/green", re: /#(F8CB46|E5B933|D4A520|0C831F|38CF5A)\b/i },
  { name: "former typeface", re: /Poppins_/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

describe("brand hygiene", () => {
  const files = walk(SRC);

  it("scans source files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { name, re } of FORBIDDEN) {
    it(`contains no ${name}`, () => {
      const hits = files.filter((f) => re.test(readFileSync(f, "utf8")));
      expect(hits).toEqual([]);
    });
  }

  // A file once saved as cp1252-over-UTF-8 put "Accept Job âœ“" on a real
  // device. These byte pairs are what ✓ … — · ₹ turn into when that happens.
  it("contains no double-encoded UTF-8 (mojibake)", () => {
    const re = /â€|âœ|â‚¹|Â·|â”/;
    const hits = files.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("does not invent money, coupons or tips in the UI", () => {
    const re = /\b(FIRST50|JUMP10|SAHAYAK20|GSTIN|walletBalance|Add a Tip)\b/;
    const hits = files.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
