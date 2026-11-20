import { describe, it, expect, vi } from "vitest";

const del = vi.fn(() => Promise.resolve({ data: { deleted: true } }));
const get = vi.fn(() => Promise.resolve({ data: { profile: { name: "Ravi" } } }));
vi.mock("../src/services/api/client", () => ({ apiClient: { delete: del, get } }));

const { partnerApi } = await import("../src/services/api/partner");
const routes: string[] = ((await import("./fixtures/backend-routes.json")) as any).routes;

describe("partner account deletion (ADR-045, Google Play account-deletion rule)", () => {
  it("calls DELETE /partners/me", async () => {
    await expect(partnerApi.deleteMe()).resolves.toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith("/partners/me");
  });

  it("the backend really serves that route", () => {
    expect(routes).toContain("DELETE /api/v1/partners/me");
  });

  it("downloads the partner's data from GET /partners/me/export", async () => {
    await expect(partnerApi.exportMe()).resolves.toEqual({ profile: { name: "Ravi" } });
    expect(get).toHaveBeenCalledWith("/partners/me/export");
    expect(routes).toContain("GET /api/v1/partners/me/export");
  });
});
