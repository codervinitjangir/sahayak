import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * The landing page once reused another company's marketing copy and a "warm paper"
 * palette with a stock serif. Neither ships. This keeps them out.
 */
const SRC = join(__dirname, '..', '..', 'src');
const FORBIDDEN: { name: string; re: RegExp; skipLanding?: boolean }[] = [
  { name: 'third-party brand name', re: /\b(blinkit|zomato|zepto|swiggy|citilink|citisum)\b/i },
  // The landing page keeps its editorial look (Fraunces, collage photos); the app screens do not.
  { name: 'former serif display font outside the landing page', re: /Fraunces/, skipLanding: true },
  { name: 'stock partner portrait outside the landing page', re: /partner_portrait|satellite_aerial_map|fleet_(van|vehicle|battery)_thumb|mechanic_portrait/, skipLanding: true },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.tsx', '.css', '.html'].includes(extname(p))) out.push(p);
  }
  return out;
}

describe('brand hygiene', () => {
  const files = walk(SRC);

  for (const { name, re, skipLanding } of FORBIDDEN) {
    it(`contains no ${name}`, () => {
      const scoped = skipLanding ? files.filter((f) => !/pages.landing.|index.css$/.test(f)) : files;
      expect(scoped.filter((f) => re.test(readFileSync(f, 'utf8')))).toEqual([]);
    });
  }

  it('has no text below 12px', () => {
    const re = /text-\[(?:[0-9]|1[01])px\]/;
    expect(files.filter((f) => re.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
