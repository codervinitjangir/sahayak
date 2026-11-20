import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("../src/constants", () => ({ API_BASE_URL: "https://api.test/api/v1" }));

import { buildCrashReport, reportCrash } from "../src/services/errorReport";

describe("crash reporting (ADR-037)", () => {
  it("sends only the error, never who the user is", () => {
    const r = buildCrashReport(new TypeError("x is undefined"), "in Foo");
    expect(r).toMatchObject({ platform: "android", message: "TypeError: x is undefined", component_stack: "in Foo" });
    expect(Object.keys(r).sort()).toEqual(["component_stack", "message", "platform", "stack"]);
  });

  it("posts to /client-errors and drops a repeat within 30 s", () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(reportCrash(new Error("loop"), null, send as never, 1_000)).toBe(true);
    expect(reportCrash(new Error("loop"), null, send as never, 5_000)).toBe(false);
    expect(reportCrash(new Error("loop"), null, send as never, 40_000)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBe("https://api.test/api/v1/client-errors");
  });

  it("never throws, even when sending fails", () => {
    const send = vi.fn(() => { throw new Error("offline"); });
    expect(reportCrash(new Error("boom"), null, send as never, 100_000)).toBe(false);
  });
});
