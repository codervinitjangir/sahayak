import React, { useState } from "react";
import { View, Text, Pressable, Linking, Share, StyleSheet } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Radius, Spacing } from "../../constants/theme";

/** India's single emergency number. */
export const EMERGENCY_NUMBER = "112";

type State = "idle" | "locating" | "error";

interface SafetyActionsProps {
  jobId?: string;
}

/**
 * Two actions that need no backend and no account: call the emergency number and
 * share your current position with someone you trust. The share goes through the
 * system share sheet as a live tracking link or maps link.
 */
export default function SafetyActions({ jobId }: SafetyActionsProps = {}) {
  const [state, setState] = useState<State>("idle");

  const call = () => {
    void Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
  };

  const shareLocation = async () => {
    setState("locating");
    try {
      if (jobId) {
        const webBase = process.env.EXPO_PUBLIC_WEB_URL || "https://sahayak.app";
        const url = `${webBase}/track/${jobId}`;
        await Share.share({ message: `Track my roadside assistance live on Sahayak: ${url}` });
        setState("idle");
        return;
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setState("error");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const url = `https://www.google.com/maps?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
      await Share.share({ message: `I need roadside help. My location: ${url}` });
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={call}
          accessibilityRole="button"
          accessibilityLabel={`Call emergency number ${EMERGENCY_NUMBER}`}
          style={({ pressed }) => [styles.btn, styles.callBtn, pressed && { backgroundColor: Colors.errorLight }]}
        >
          <Ionicons name="call" size={20} color={Colors.error} />
          <Text style={[styles.label, { color: Colors.error }]}>Call {EMERGENCY_NUMBER}</Text>
        </Pressable>
        <Pressable
          onPress={shareLocation}
          disabled={state === "locating"}
          accessibilityRole="button"
          accessibilityLabel="Share my location"
          style={({ pressed }) => [styles.btn, styles.shareBtn, pressed && { backgroundColor: Colors.borderLight }]}
        >
          <Ionicons name="share-social-outline" size={20} color={Colors.brand700} />
          <Text style={[styles.label, { color: Colors.textPrimary }]}>
            {state === "locating" ? "Locating…" : "Share location"}
          </Text>
        </Pressable>
      </View>
      {state === "error" ? (
        <Text style={styles.error} accessibilityRole="alert">
          Could not get your location. Check that location access is allowed.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: Spacing.md },
  btn: {
    flex: 1,
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surfaceWhite,
  },
  callBtn: { borderColor: Colors.emergency },
  shareBtn: { borderColor: Colors.border },
  label: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold },
  error: { marginTop: 8, fontSize: Typography.fontSize.sm, color: Colors.error, fontFamily: Typography.fontFamily.medium },
});
