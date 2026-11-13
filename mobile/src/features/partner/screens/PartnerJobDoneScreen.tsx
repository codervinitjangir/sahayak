// ─── Sahayak — Partner Job Done Screen ───────────────────────────────────────
// The completion receipt for the mechanic. It reads the job back from the
// backend so the amount shown is the price_final that was actually saved, not
// a number passed through navigation or remembered locally.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { jobsApi } from "../../../services/api/jobs";
import type { BackendJob } from "../../../services/api/jobs";
import { partnerApi } from "../../../services/api/partner";
import type { MobilePartnerEarnings } from "../../../services/api/partner";
import { useAuthStore } from "../../../store/authStore";
import type { PartnerStackParamList } from "../../../types";
import { inr } from "../partnerFormat";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "PartnerJobDone">;
type Route = RouteProp<PartnerStackParamList, "PartnerJobDone">;

const formatCompletedAt = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function PartnerJobDoneScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const jobId = route.params?.jobId;
  const partnerName = useAuthStore((s) => s.user?.name);

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [job, setJob] = useState<BackendJob | null>(null);
  const [earnings, setEarnings] = useState<MobilePartnerEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      setLoadError("No job was selected, so there is no receipt to show.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setJob(await jobsApi.getJob(jobId));
    } catch {
      setLoadError(
        "Sahayak could not load this completed job. The work is still saved; check your connection and retry."
      );
    }
    try {
      setEarnings(await partnerApi.getEarnings());
    } catch {
      // The receipt is the job itself; today's running total is extra context.
      setEarnings(null);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 55,
        friction: 7,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const firstName = partnerName?.trim().split(/\s+/)[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.splash}>
          <Animated.View
            style={[styles.successCircle, { transform: [{ scale: scaleAnim }] }]}
          >
            <Ionicons name="checkmark" size={48} color={Colors.textWhite} />
          </Animated.View>
          <Text style={styles.successTitle}>Job complete</Text>
          <Text style={styles.successSubtitle}>
            {firstName ? `Great work, ${firstName}.` : "Great work."}
          </Text>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator size="small" color={Colors.brand700} />
            <Text style={styles.stateText}>Loading the saved receipt…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={Colors.textSecondary} />
            <Text style={styles.stateText}>{loadError}</Text>
            <Button
              label="Retry"
              onPress={() => void load()}
              variant="primary"
              fullWidth
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        ) : job ? (
          <Animated.View style={{ opacity: fadeAnim }}>
            <Card style={styles.earningsCard} bg={Colors.secondary}>
              <Text style={styles.earningsLabel}>Final amount recorded</Text>
              <Text style={styles.earningsAmount}>{inr(job.price_final)}</Text>
              <Text style={styles.earningsNote}>
                {job.service_name ?? job.service_code ?? "Roadside rescue"}
                {formatCompletedAt(job.completed_at)
                  ? ` · ${formatCompletedAt(job.completed_at)}`
                  : ""}
              </Text>
              <View style={styles.earningsStats}>
                <View style={styles.earnStat}>
                  <Text style={styles.earnStatVal}>
                    {earnings ? String(earnings.today_jobs) : "—"}
                  </Text>
                  <Text style={styles.earnStatLbl}>Jobs today</Text>
                </View>
                <View style={styles.earnDivider} />
                <View style={styles.earnStat}>
                  <Text style={styles.earnStatVal}>
                    {earnings ? inr(earnings.today_amount) : "—"}
                  </Text>
                  <Text style={styles.earnStatLbl}>Today's total</Text>
                </View>
              </View>
            </Card>

            <Card style={styles.breakdownCard}>
              <Text style={styles.sectionTitle}>Job receipt</Text>

              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Customer</Text>
                <Text style={styles.costValue}>
                  {job.owner_name ?? "Not provided"}
                </Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Pickup</Text>
                <Text style={styles.costValue} numberOfLines={2}>
                  {job.pickup_address_text}
                </Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Vehicle</Text>
                <Text style={styles.costValue}>
                  {job.vehicle_number ?? "Not provided"}
                </Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Final amount</Text>
                <Text style={styles.costValue}>{inr(job.price_final)}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.costRow}>
                <Text style={styles.totalLabel}>Final amount</Text>
                <Text style={styles.totalAmount}>{inr(job.price_final)}</Text>
              </View>

              <Text style={styles.payoutNote}>
                This is the amount saved against the job. Payouts are settled by
                Sahayak operations; there is no in-app withdrawal.
              </Text>
            </Card>
          </Animated.View>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={[styles.donePanel, Shadows.sheet as object]}>
        <Button
          label="Back to dashboard"
          onPress={() => nav.popToTop()}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { paddingBottom: 20 },

  splash: {
    alignItems: "center",
    paddingTop: Spacing["3xl"],
    paddingBottom: Spacing["2xl"],
    backgroundColor: Colors.surfaceWhite,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  successTitle: {
    fontSize: Typography.fontSize["3xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  successSubtitle: {
    fontSize: Typography.fontSize.base,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },

  stateCard: {
    alignItems: "center",
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    gap: 6,
  },
  stateText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  earningsCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    alignItems: "center",
    gap: 4,
  },
  earningsLabel: {
    fontSize: Typography.fontSize.base,
    color: "rgba(255,255,255,0.7)",
    fontFamily: Typography.fontFamily.regular,
  },
  earningsAmount: {
    fontSize: 48,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
    lineHeight: 56,
  },
  earningsNote: {
    fontSize: Typography.fontSize.sm,
    color: "rgba(255,255,255,0.6)",
    fontFamily: Typography.fontFamily.regular,
    marginBottom: Spacing.base,
    textAlign: "center",
  },
  earningsStats: {
    flexDirection: "row",
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
    paddingTop: Spacing.sm,
  },
  earnStat: { flex: 1, alignItems: "center", gap: 4 },
  earnStatVal: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  earnStatLbl: {
    fontSize: Typography.fontSize.xs,
    color: "rgba(255,255,255,0.6)",
    fontFamily: Typography.fontFamily.regular,
  },
  earnDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.15)" },

  breakdownCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: 10,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  costLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  costValue: {
    flex: 1,
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    textAlign: "right",
  },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  totalLabel: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  totalAmount: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.success,
  },
  payoutNote: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textMuted,
    lineHeight: 16,
  },

  donePanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
  },
});
