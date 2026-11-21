import { describe, it, expect } from "vitest";
import { OWNER_COMING_SOON, PARTNER_COMING_SOON } from "../src/features/home/comingSoon";

describe("coming soon lists", () => {
  const all = [...OWNER_COMING_SOON, ...PARTNER_COMING_SOON];

  it("ids are unique across owner and partner lists", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it("owner list carries no B2B card", () => {
    expect(OWNER_COMING_SOON.map((s) => s.id)).toEqual(["doorstep", "pickup-drop"]);
    expect(OWNER_COMING_SOON.some((s) => /business/i.test(s.title))).toBe(false);
  });

  it("never claims a price or a booking", () => {
    for (const s of all) {
      expect(`${s.title} ${s.blurb} ${s.detail}`).not.toMatch(/₹|book now|available now/i);
    }
  });
});
