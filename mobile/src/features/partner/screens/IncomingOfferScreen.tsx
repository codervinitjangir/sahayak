// ─── Sahayak — Incoming Offer Screen (Partner) ───────────────────────────────
// Everything on this screen comes from the offer the dispatch engine actually
// sent: GET /partners/me/offers items carry { assignment_id, job_id, offered_at,
// distance_at_offer_m, estimated_arrival_min, job }. There is deliberately no
// fallback job or made-up pickup when that payload is missing — a fabricated
// address here would send a mechanic to the wrong street.
import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Animated, StatusBar, Platform } from "react-native";
import { showDialog } from "../../../components/ui/AppDialog";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { jobsApi } from "../../../services/api/jobs";
import type { BackendPartnerOfferItem } from "../../../services/api/jobs";
import type { PartnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";
import { inr, metresToKm, serviceMetaFor } from "../partnerFormat";
import { OFFER_URGENT_S, formatCountdown, offerDeadlineMs, useSecondsLeft } from "../offerCountdown";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "IncomingOffer">;
type Route = RouteProp<PartnerStackParamList, "IncomingOffer">;

export default function IncomingOfferScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const offer = route.params?.offerData as BackendPartnerOfferItem | undefined;
  const job = offer?.job;
  const meta = serviceMetaFor(job?.service_code);
  const assignmentId = route.params?.assignmentId;

  // ADR-032: the offer is passed to the next partner 60 s after it was made.
  const left = useSecondsLeft(offerDeadlineMs(offer));
  const expired = left === 0;
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [slideAnim]);

  if (!offer || !job) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.missingCard}>
          <Ionicons name="alert-circle-outline" size={36} color={Colors.textSecondary} />
          <Text style={styles.missingTitle}>Offer unavailable</Text>
          <Text style={styles.missingText}>
            This offer is no longer available in the app. Return to the
            dashboard and wait for the next dispatch.
          </Text>
          <Button
            label="Back to dashboard"
            onPress={() => nav.goBack()}
            variant="primary"
            size="md"
            fullWidth
            style={{ marginTop: 12 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const distanceLabel = metresToKm(offer.distance_at_offer_m);
  const etaLabel =
    offer.estimated_arrival_min != null
      ? `${offer.estimated_arrival_min} min ETA`
      : null;

  const handleAccept = async () => {
    if (!assignmentId) {
      showDialog(
        "Offer unavailable",
        "The assignment reference is missing, so this offer cannot be accepted. Go back and reopen it from the dashboard."
      );
      return;
    }
    setAccepting(true);
    try {
      await jobsApi.respondToAssignment(assignmentId, "accept");
      nav.replace("ActiveJob", { jobId: offer.job_id });
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === "PARTNER_AT_CAPACITY") {
        showDialog(
          "Limit reached",
          "You are at your concurrent job limit. Complete an existing job before accepting another."
        );
      } else if (code === "ASSIGNMENT_ALREADY_ANSWERED") {
        showDialog(
          "Offer expired",
          "This job is no longer available or was taken by another technician.",
          [{ text: "OK", onPress: () => nav.goBack() }]
        );
      } else {
        showDialog(
          "Could not accept",
          "Sahayak did not confirm this job. You have not been assigned to it. Check your connection and try again."
        );
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!assignmentId) {
      nav.goBack();
      return;
    }
    setDeclining(true);
    try {
      await jobsApi.respondToAssignment(assignmentId, "reject", "Partner declined");
      nav.goBack();
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === "ASSIGNMENT_ALREADY_ANSWERED") {
        // Already answered elsewhere; leaving is correct.
        nav.goBack();
      } else {
        showDialog(
          "Could not decline",
          "Sahayak could not record your response. The offer may still be open; try again or let it expire."
        );
      }
    } finally {
      setDeclining(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHero
        title="New job offer"
        greeting={meta.label ?? "Roadside job"}
        subtitle={
          left === null
            ? "Live roadside dispatch"
            : expired
            ? "Time is up. Passing to the next partner"
            : `Respond within ${formatCountdown(left)}`
        }
        left={{ icon: "arrow-back", label: "Back to dashboard", onPress: () => nav.goBack() }}
        right={
          <View style={styles.livePill} accessibilityLabel="Live offer">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        }
        center
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero: service + owner's quote, stacked so nothing clips ── */}
        <View style={styles.hero}>
          <Text style={styles.heroService} numberOfLines={2}>
            {job.service_name ?? meta.label}
          </Text>
          <View style={styles.heroPriceRow}>
            <Text style={styles.heroAmount}>
              {job.price_estimate != null ? inr(job.price_estimate) : "Price on completion"}
            </Text>
            {job.price_estimate != null ? (
              <Text style={styles.heroAmountLabel}>owner's quote</Text>
            ) : null}
          </View>
          <Text style={styles.heroNote}>You enter the final amount when the job is done.</Text>

          {(distanceLabel || etaLabel) && (
            <View style={styles.heroStats}>
              {distanceLabel && (
                <View style={styles.heroStat}>
                  <Ionicons name="navigate" size={14} color={Colors.primaryLight} />
                  <Text style={styles.heroStatText}>{distanceLabel} away</Text>
                </View>
              )}
              {etaLabel && (
                <View style={styles.heroStat}>
                  <Ionicons name="time" size={14} color={Colors.primaryLight} />
                  <Text style={styles.heroStatText}>{etaLabel}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── Pickup ── */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Pickup</Text>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: Colors.primaryMuted }]}>
              <Ionicons name="location" size={20} color={Colors.primary} />
            </View>
            <Text style={styles.pickupText}>
              {job.pickup_address_text ?? "Address not provided. The exact pin is shared when you accept."}
            </Text>
          </View>
        </Card>

        {/* ── Vehicle and what the owner said ── */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: Colors.surface }]}>
              <Ionicons name="car-sport" size={20} color={Colors.secondary} />
            </View>
            {job.vehicle_number ? (
              <View style={styles.plate}>
                <Text style={styles.plateText}>{job.vehicle_number}</Text>
              </View>
            ) : (
              <Text style={styles.mutedText}>Registration not provided</Text>
            )}
          </View>
          {job.issue_description ? (
            <View style={styles.issueBox}>
              <Text style={styles.issueLabel}>Owner's note</Text>
              <Text style={styles.issueText}>{job.issue_description}</Text>
            </View>
          ) : null}
        </Card>

        <Text style={styles.privacyNote}>
          The owner's name, phone and exact pin are shared once you accept.
        </Text>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Actions ── */}
      <Animated.View
        style={[
          styles.bottomPanel,
          Shadows.sheet as ViewStyle,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.actionRow}>
          <Button
            label={declining ? "Declining…" : "Decline"}
            onPress={handleDecline}
            loading={declining}
            disabled={accepting}
            variant="ghost"
            style={styles.declineBtn}
            textStyle={{ color: Colors.error }}
            fullWidth={false}
            accessibilityLabel="Decline this offer"
          />
          <Button
            label={accepting ? "Accepting…" : expired ? "Offer expired" : "Accept job"}
            onPress={handleAccept}
            loading={accepting}
            disabled={declining || expired}
            variant="primary"
            style={styles.acceptBtn}
            fullWidth={false}
            accessibilityLabel={expired ? "Offer expired" : "Accept this job"}
          />
        </View>
        {left !== null && !expired && left <= OFFER_URGENT_S ? (
          <Text style={styles.urgentNote} accessibilityLiveRegion="polite">
            {left} seconds left before this job goes to another partner.
          </Text>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  urgentNote: {
    marginTop: Spacing.sm,
    textAlign: "center",
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.warning,
  },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg },

  missingCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: 8,
  },
  missingTitle: {
    fontSize: Typography.fontSize.xl,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginTop: 4,
  },
  missingText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  alertHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  alertLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  alertIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  alertSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.successLight,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  liveText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.success,
    letterSpacing: 0.8,
  },

  hero: {
    backgroundColor: Colors.secondary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  heroService: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: "rgba(255,255,255,0.85)",
  },
  heroPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  heroAmount: {
    fontSize: Typography.fontSize["3xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  heroAmountLabel: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: "rgba(255,255,255,0.7)",
  },
  heroNote: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255,255,255,0.7)",
    marginTop: 4,
    lineHeight: 20,
  },
  heroStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: Spacing.base,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  heroStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  heroStatText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textWhite,
  },

  card: { marginBottom: Spacing.md, gap: 12 },
  cardLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  pickupText: {
    flex: 1,
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  plate: {
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceWhite,
  },
  plateText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    letterSpacing: 1.5,
  },
  mutedText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
  },
  issueBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  issueLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  issueText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  privacyNote: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: Spacing.base,
    lineHeight: 20,
  },

  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: Spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionRow: { flexDirection: "row", gap: Spacing.sm },
  declineBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.errorLight,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    height: 56,
  },
  acceptBtn: {
    flex: 2,
    height: 56,
  },
});
