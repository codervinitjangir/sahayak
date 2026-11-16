import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Height of the on-screen keyboard, 0 when it is closed.
 *
 * Android runs edge-to-edge, so the window is not resized and absolutely
 * positioned bottom sheets (and transparent modals) stay under the keyboard;
 * callers lift themselves by this amount.
 *
 * `keyboardDidHide` is not always delivered on Android (back gesture, a
 * dismiss during a screen change). A stale height left the partner's job sheet
 * floating a keyboard-height above the bottom with the map showing beneath it,
 * so while the height is non-zero we also confirm the keyboard is still up.
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
      if (!Keyboard.isVisible()) setHeight(0);
    }, 400);
    return () => clearInterval(t);
  }, [height]);

  return height;
}
