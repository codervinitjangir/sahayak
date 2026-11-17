import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Radius, Spacing } from "../../constants/theme";
import Card from "../../components/ui/Card";
import { SectionHeader } from "../../components/ui/kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComingSoonItem } from "./comingSoon";
import { featureInterestApi, type ComingSoonFeature } from "../../services/api/featureInterest";

// Announced only (docs/FUTURE-ROADMAP.md). No price, slot or booking action.
// Tapping a row expands it; "Notify me" records interest (ADR-035).
// `side` keeps an owner's and a partner's lists apart when one login holds both (ADR-034).
export default function ComingSoonServices({
  side,
  items,
}: {
  side: "owner" | "partner";
  items: readonly ComingSoonItem[];
}) {
  const COMING_SOON = items;
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const key = ["feature-interest", side];
  const interest = useQuery({ queryKey: key, queryFn: () => featureInterestApi.listMine() });
  const notify = useMutation({
    mutationFn: (f: ComingSoonFeature) => featureInterestApi.register(f),
    onSuccess: (features) => qc.setQueryData(key, features),
  });
  const asked = new Set<string>(interest.data ?? []);

  return (
    <View>
      <SectionHeader title="Coming soon" />
      <Card noPad>
        {COMING_SOON.map((s, i) => {
          const isOpen = open === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => setOpen(isOpen ? null : s.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${s.title}, coming soon`}
              style={[styles.row, i < COMING_SOON.length - 1 && styles.divider]}
            >
              <View style={styles.head}>
                <View style={styles.icon}>
                  <Ionicons name={s.icon as keyof typeof Ionicons.glyphMap} size={22} color={Colors.brand700} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{s.title}</Text>
                    <Text style={styles.badge}>COMING SOON</Text>
                  </View>
                  <Text style={styles.muted}>{s.blurb}</Text>
                </View>
                <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={Colors.textSecondary} />
              </View>
              {isOpen && (
                <View style={styles.detail}>
                  <Text style={[styles.muted, { lineHeight: 20 }]}>{s.detail}</Text>
                  {asked.has(s.id) ? (
                    <View style={styles.doneRow} accessibilityRole="text">
                      <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                      <Text style={styles.doneText}>We will tell you when this launches</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => notify.mutate(s.id)}
                      disabled={notify.isPending || interest.isLoading}
                      accessibilityRole="button"
                      accessibilityLabel={`Notify me when ${s.title} launches`}
                      style={({ pressed }) => [styles.notifyBtn, (pressed || notify.isPending) && { opacity: 0.6 }]}
                    >
                      <Ionicons name="notifications-outline" size={18} color={Colors.textPrimary} />
                      <Text style={styles.notifyText}>
                        {notify.isPending && notify.variables === s.id ? "Saving…" : "Notify me"}
                      </Text>
                    </Pressable>
                  )}
                  {notify.isError && notify.variables === s.id && (
                    <Text style={styles.error} accessibilityRole="alert">
                      Could not save that. Please try again.
                    </Text>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { padding: Spacing.base, minHeight: 64 },
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  badge: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    letterSpacing: 0.6,
    color: Colors.textSecondary,
    backgroundColor: Colors.brand700Muted,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  muted: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
  detail: { marginTop: Spacing.sm, marginLeft: 40 + Spacing.md, gap: Spacing.md },
  notifyBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
  },
  notifyText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  doneText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.success },
  error: { fontSize: Typography.fontSize.sm, color: Colors.error, fontFamily: Typography.fontFamily.regular },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
});
