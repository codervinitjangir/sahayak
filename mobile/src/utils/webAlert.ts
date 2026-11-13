// React Native Web ships Alert.alert as a no-op, so every error popup in the app is
// invisible in the browser (a failed OTP send looked like an endless "Sending Code…").
// This shim maps Alert.alert onto window.alert / window.confirm on web only; native
// behaviour is untouched. Import once, before the app renders.
import { Alert, Platform, type AlertButton } from "react-native";

if (Platform.OS === "web" && typeof window !== "undefined") {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const actions = buttons ?? [];
    const cancel = actions.find((b) => b.style === "cancel");
    const others = actions.filter((b) => b !== cancel);

    if (others.length === 0) {
      window.alert(text);
      (cancel ?? actions[0])?.onPress?.();
      return;
    }
    // Two-way choice: OK runs the first non-cancel action, Cancel runs the cancel one.
    // More than two actions cannot be shown by confirm(); the first action wins.
    if (window.confirm(text)) others[0].onPress?.();
    else cancel?.onPress?.();
  };
}
