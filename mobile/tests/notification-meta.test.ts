import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notificationMeta, routeForNotification } from "../src/services/notificationMeta";

describe("routeForNotification", () => {
  it("owner taps open the request", () => {
    expect(routeForNotification("owner", "job_partner_en_route", "j1")).toEqual({ name: "OwnerFlow", params: { jobId: "j1" } });
    expect(routeForNotification("owner", "job_completed", null)).toBeNull();
  });

  it("partner offer taps open the dashboard, which re-reads the live offer", () => {
    expect(routeForNotification("partner", "job_offered", "j1")).toEqual({ name: "PartnerHome" });
  });

  it("partner never lands on a job that left them", () => {
    expect(routeForNotification("partner", "job_cancelled_by_owner", "j1")).toEqual({ name: "PartnerHome" });
    expect(routeForNotification("partner", "job_reassigned_by_support", "j1")).toEqual({ name: "PartnerHome" });
    expect(routeForNotification("partner", "job_in_progress", "j1")).toEqual({ name: "ActiveJob", params: { jobId: "j1" } });
  });
});

describe("notification titles", () => {
  it("match the push titles the backend sends", () => {
    const py = readFileSync(join(__dirname, "..", "..", "backend", "app", "services", "push_service.py"), "utf8");
    const block = py.slice(py.indexOf("PUSH_TITLES"), py.indexOf("}", py.indexOf("PUSH_TITLES")));
    const pairs = [...block.matchAll(/"(\w+)":\s*"([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThan(8);
    for (const [, event, title] of pairs) {
      expect(notificationMeta(event).title, event).toBe(title);
    }
  });

  it("an unknown event still gets a readable title", () => {
    expect(notificationMeta("job_something_new").title).toBe("Something new");
  });
});
