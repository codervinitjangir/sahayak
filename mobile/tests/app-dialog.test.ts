import { describe, expect, it } from "vitest";
import { inferTone, orderButtons } from "../src/components/ui/AppDialog";

describe("orderButtons", () => {
  it("adds a single OK when the caller passes no buttons", () => {
    expect(orderButtons(undefined)).toEqual([{ text: "OK" }]);
  });

  it("puts cancel first and the main action last", () => {
    const out = orderButtons([{ text: "Sign out", style: "destructive" }, { text: "Cancel", style: "cancel" }]);
    expect(out.map((b) => b.text)).toEqual(["Cancel", "Sign out"]);
  });
});

describe("inferTone", () => {
  it("treats a destructive choice as a danger confirm", () => {
    expect(inferTone("Sign out?", "You will need to verify again.", [{ style: "cancel" }, { style: "destructive" }])).toBe("danger");
  });

  it("marks failure wording as an error", () => {
    expect(inferTone("Could not go on duty", "Sahayak could not register your availability.", [{ text: "OK" }])).toBe("error");
  });

  it("keeps neutral messages as info", () => {
    expect(inferTone("Location updated", "Dispatch has your current position.", [{ text: "OK" }])).toBe("info");
  });
});
