// ─── Sahayak — Tracking Screen ────────────────────────────────────────────────
import React from "react";
import { View, Text, StyleSheet, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "../../../constants/theme";

export default function TrackingScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      <View style={styles.center}>
        <Ionicons name="navigate-circle-outline" size={72} color={Colors.shimmerBase} />
        <Text style={styles.title}>No Active Job</Text>
        <Text style={styles.sub}>
          Your live tracking will appear here once a request is matched.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.base,
  },
  title: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  sub: {
    fontSize: Typography.fontSize.base,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    textAlign: "center",
    lineHeight: 24,
  },
});

