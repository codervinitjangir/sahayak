import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("../src/services/api/safeguards", () => ({ safeguardsApi: {} }));
vi.mock("../src/services/api/jobs", () => ({ jobsApi: {} }));

import { uploadIssuePhoto, uploadIssuePhotos } from "../src/features/jobs/photos/issuePhotos";
import { fromPrice } from "../src/features/jobs/components/ServiceTiles";
import { dayParts } from "../src/features/jobs/components/SlotPicker";

describe("owner photos of the problem (ADR-055)", () => {
  it("one photo is ticket, PUT, confirm, in that order", async () => {
    const calls: string[] = [];
    const api = {
      startIssuePhoto: vi.fn(async (_j: string, ct: string) => { calls.push(`start:${ct}`); return { photo_id: "p1", upload_url: "https://u", max_bytes: 1 }; }),
      confirmIssuePhoto: vi.fn(async () => { calls.push("confirm"); return { id: "p1", stage: "issue" as const }; }),
    };
    const put = vi.fn(async () => { calls.push("put"); });
    await uploadIssuePhoto("j1", { uri: "file:///a.png", mimeType: "image/png" }, api as never, put);
    expect(calls).toEqual(["start:image/png", "put", "confirm"]);
    expect(api.confirmIssuePhoto).toHaveBeenCalledWith("j1", "p1");
  });

  it("a failed photo is counted, never thrown, and at most three are sent", async () => {
    const upload = vi.fn(async (_j: string, p: { uri: string }) => { if (p.uri === "b") throw new Error("x"); });
    const r = await uploadIssuePhotos("j1", [{ uri: "a" }, { uri: "b" }, { uri: "c" }, { uri: "d" }], upload);
    expect(r).toEqual({ sent: 2, failed: 1 });
    expect(upload).toHaveBeenCalledTimes(3);
  });
});

describe("request screen helpers", () => {
  it("shows a price only when the catalogue has one", () => {
    expect(fromPrice(399)).toBe("from ₹399");
    expect(fromPrice("1250.00")).toBe("from ₹1,250");
    expect(fromPrice(null)).toBeNull();
    expect(fromPrice(0)).toBeNull();
  });
  it("splits a day label into the card's three lines", () => {
    expect(dayParts("Sun 23 Nov")).toEqual(["Sun", "23", "Nov"]);
  });
});
