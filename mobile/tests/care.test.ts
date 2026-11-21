import { describe, it, expect } from "vitest";
import { calloutsLine, careDate } from "../src/features/care/care";

// ADR-051: Sahayak Care wording, India time whatever the phone's timezone.
describe("Sahayak Care helpers", () => {
  it("formats the end date in India time", () => {
    expect(careDate("2027-11-21T06:00:00Z")).toBe("21 Nov 2027");
    expect(careDate("2027-11-20T19:00:00Z")).toBe("21 Nov 2027");
    expect(careDate(null)).toBe("");
  });

  it("says how many covered call-outs are left", () => {
    expect(calloutsLine({ callouts_left: 0, callouts_allowed: 4 })).toBe("0 of 4 covered call-outs left");
  });
});
