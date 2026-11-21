import { useEffect, useState } from "react";
import { Keyboard, Platform, TextInput } from "react-native";

/**
 * Is the keyboard still up? Used to drop a stale height.
 *
 * `Keyboard.isVisible()` alone cannot answer it: React Native returns the last
 * show/hide *event* it saw (`!!this._currentlyShowing`), so when the hide event
 * is the one that went missing it still says "visible" and the stale height is
 * never cleared. That was the owner's request sheet floating a keyboard-height
 * up after sending (the notes field unmounts with the keyboard open), fixed only
 * by leaving and reopening the screen. A keyboard with no focused text field
 * is gone in practice, so the focused-input check is the one that catches it.
 */
export function keyboardStillUp(eventSaysVisible: boolean, hasFocusedInput: boolean): boolean {
  return eventSaysVisible && hasFocusedInput;
}

/**
 * Height of the on-screen keyboard, 0 when it is closed.
 *
 * Android runs edge-to-edge, so the window is not resized and absolutely
 * positioned bottom sheets (and transparent modals) stay under the keyboard;
 * callers lift themselves by this amount.
 *
 * `keyboardDidHide` is not always delivered on Android (back gesture, a
 * dismiss during a screen change, the focused field unmounting). While the
 * height is non-zero we re-check every 300 ms with `keyboardStillUp`.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (height === 0) return;
    const t = setInterval(() => {
      if (!keyboardStillUp(Keyboard.isVisible(), TextInput.State.currentlyFocusedInput() != null)) setHeight(0);
    }, 300);
    return () => clearInterval(t);
  }, [height]);

  return height;
}
