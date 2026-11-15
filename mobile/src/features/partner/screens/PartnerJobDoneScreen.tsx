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
  Pressable,
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
import { paymentsApi } from "../../../services/api/payments";
import type { PaymentRecord } from "../../../services/api/payments";
import type { MobilePartnerEarnings } from "../../../services/api/partner";
import { useAuthStore } from "../../../store/authStore";
import type { PartnerStackParamList } from "../../../types";
import { firstNameFor, inr } from "../partnerFormat";

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
  const [partnerRating, setPartnerRating] = useState<number>(0);
  const [ratingSubmitted, setRatingSubmitted] = useState<boolean>(false);
  const [submittingRating, setSubmittingRating] = useState<boolean>(false);
  // Settlement is the receiving side's call: the owner can open the UPI
  // intent, but only the partner (or an admin) can say the money arrived.
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [confirming, setConfirming] = useState<"upi" | "cash" | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const confirmReceived = async (method: "upi" | "cash") => {
    if (!jobId) return;
    setConfirming(method);
    setPaymentError(null);
    try {
      let current = payment;
      if (!current) {
        current = await paymentsApi.createPayment({ job_id: jobId, payment_method: method });
      }
      setPayment(await paymentsApi.confirmPayment(current.id, { payment_method: method }));
    } catch {
      setPaymentError("Could not record the payment. Check your connection and try again.");
    } finally {
      setConfirming(null);
    }
  };

  const handleRateCustomer = async (score: number) => {
    setPartnerRating(score);
    if (!jobId) return;
    setSubmittingRating(true);
    try {
      await jobsApi.submitRating(jobId, score);
      setRatingSubmitted(true);
    } catch {
      // If already rated or error, keep score
    } finally {
      setSubmittingRating(false);
    }
  };

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
      setPayment(await paymentsApi.getJobPayment(jobId));
    } catch {
      // 404 until the owner opens a payment; confirming will open one.
      setPayment(null);
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

  const firstName = firstNameFor(partnerName);

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

            <Card style={styles.ratingCard}>
              <Text style={styles.cardHeading}>Payment</Text>
              {payment?.status === "paid" ? (
                <Text style={styles.ratingThanks}>
                  Received{payment.payment_method ? ` by ${payment.payment_method.toUpperCase()}` : ""}. Thank you!
                </Text>
              ) : (
                <>
                  <Text style={styles.ratingSubtitle}>
                    Mark this bill settled once the money is in your hands or your UPI account.
                  </Text>
                  <Button
                    label="Cash received"
                    onPress={() => void confirmReceived("cash")}
                    variant="primary"
                    loading={confirming === "cash"}
                    disabled={confirming !== null}
                    fullWidth
                  />
                  <Button
                    label="UPI payment received"
                    onPress={() => void confirmReceived("upi")}
                    variant="secondary"
                    loading={confirming === "upi"}
                    disabled={confirming !== null}
                    fullWidth
                  />
                  {paymentError && <Text style={styles.ratingSubtitle}>{paymentError}</Text>}
                </>
              )}
            </Card>

            <Card style={styles.ratingCard}>
              <Text style={styles.cardHeading}>Rate vehicle owner</Text>
              <Text style={styles.ratingSubtitle}>
                How was your experience with {job.owner_name || "the vehicle owner"}?
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    disabled={ratingSubmitted || submittingRating}
                    onPress={() => void handleRateCustomer(star)}
                    style={styles.starBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Rate ${star} stars`}
                  >
                    <Ionicons
                      name={star <= partnerRating ? "star" : "star-outline"}
                      size={32}
                      color={star <= partnerRating ? Colors.primary : Colors.border}
                    />
                  </Pressable>
                ))}
              </View>
              {ratingSubmitted && (
                <Text style={styles.ratingThanks}>Thank you for rating the customer!</Text>
              )}
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

  ratingCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    gap: 8,
    alignItems: "center",
  },
  cardHeading: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  ratingSubtitle: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  starsRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: Spacing.sm,
  },
  starBtn: {
    padding: 4,
  },
  ratingThanks: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.primary,
    marginTop: 4,
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
