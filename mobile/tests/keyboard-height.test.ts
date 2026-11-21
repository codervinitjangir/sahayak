import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" }, Keyboard: {}, TextInput: { State: {} } }));

import { keyboardStillUp } from "../src/hooks/useKeyboardHeight";

describe("stale keyboard height (owner sheet after sending)", () => {
  it("a missed hide event with no focused field is not a keyboard", () => {
    // Keyboard.isVisible() still says true: it is the cached last event.
    expect(keyboardStillUp(true, false)).toBe(false);
  });
  it("a real keyboard over a focused field stays", () => {
    expect(keyboardStillUp(true, true)).toBe(true);
  });
  it("a delivered hide event clears it", () => {
    expect(keyboardStillUp(false, true)).toBe(false);
    expect(keyboardStillUp(false, false)).toBe(false);
  });
});
