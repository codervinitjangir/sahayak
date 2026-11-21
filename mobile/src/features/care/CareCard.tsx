import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius } from "../../constants/theme";
import { calloutsLine, careDate, type MyCare } from "./care";
import { useTranslation } from "../../i18n";

/** Shown only to a member (ADR-051). Nothing is on sale yet, so a non-member sees nothing. */
export default function CareCard({ care }: { care: MyCare | undefined }) {
  const { t } = useTranslation();
  const m = care?.membership;
  if (!m) return null;
  return (
    <View style={styles.card} accessible accessibilityLabel={t("care.a11y", { plan: m.plan_name, date: careDate(m.ends_at), callouts: calloutsLine(m) })}>
      <View style={styles.head}>
        <Ionicons name="shield-checkmark" size={22} color="#15803D" />
        <Text style={styles.title}>{m.plan_name}</Text>
      </View>
      <Text style={styles.line}>{t("care.coveredUntil", { date: careDate(m.ends_at) })}</Text>
      <Text style={styles.strong}>{calloutsLine(m)}</Text>
      <Text style={styles.note}>{care!.pricing_note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    gap: 4,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  line: { fontSize: 15, color: Colors.textPrimary },
  strong: { fontSize: 15, fontWeight: "700", color: "#14532D" },
  note: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginTop: 4 },
});
