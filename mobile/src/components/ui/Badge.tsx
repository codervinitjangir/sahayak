// ─── Sahayak — Badge Component ────────────────────────────────────────────────
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Typography, Radius } from "../../constants/theme";
import { JobStatusConfig } from "../../constants/theme";
import type { JobStatus } from "../../types";

interface BadgeProps {
  label: string;
  color?: string;
  bg?: string;
}

export function Badge({ label, color = Colors.textSecondary, bg = Colors.border }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

interface StatusBadgeProps {
  status: JobStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = JobStatusConfig[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  text: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    letterSpacing: Typography.letterSpacing.wide,
  },
});

