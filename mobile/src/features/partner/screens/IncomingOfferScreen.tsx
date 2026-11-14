// â”€â”€â”€ Sahayak â€” Incoming Offer Screen (Partner) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Everything on this screen comes from the offer the dispatch engine actually
// sent: GET /partners/me/offers items carry { assignment_id, job_id, offered_at,
// distance_at_offer_m, estimated_arrival_min, job }. There is deliberately no
// fallback job or made-up pickup when that payload is missing â€” a fabricated
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
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { jobsApi } from "../../../services/api/jobs";
import type { BackendPartnerOfferItem } from "../../../services/api/jobs";
import type { PartnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";
import { inr, metresToKm, serviceMetaFor } from "../partnerFormat";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "IncomingOffer">;
type Route = RouteProp<PartnerStackParamList, "IncomingOffer">;

export default function IncomingOfferScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const offer = route.params?.offerData as BackendPartnerOfferItem | undefined;
  const job = offer?.job;
  const meta = serviceMetaFor(job?.service_code);
  const assignmentId = route.params?.assignmentId;

  const offeredAt = offer?.offered_at;
  const [relativeAge, setRelativeAge] = useState<string>("Just now");
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

    if (!offeredAt) return;
    const calc = () => {
      const diffMins = Math.floor((Date.now() - new Date(offeredAt).getTime()) / 60000);
      if (diffMins <= 0) setRelativeAge("Just now");
      else setRelativeAge(`${diffMins}m ago`);
    };
    calc();
    const interval = setInterval(calc, 30000);
    return () => clearInterval(interval);
  }, [offeredAt]);

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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" />

      {/* â”€â”€ Alert Header (Figma: offer-alert-header â€” bg #F0FDFA) â”€â”€ */}
      <View style={styles.alertHeader}>
        <View style={styles.alertLeft}>
          <View style={styles.alertIconWrap}>
            <Ionicons name="flash" size={24} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.alertTitle}>New Breakdown Offer!</Text>
            <Text style={styles.alertSubtitle}>
              {offeredAt ? `Offered ${relativeAge}` : "Live roadside dispatch"}
            </Text>
          </View>
        </View>
        <View style={styles.timerCircle}>
          <Ionicons name="radio" size={14} color={Colors.success} />
          <Text style={[styles.timerText, { color: Colors.success, fontSize: 12 }]}>LIVE</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* â”€â”€ Owner's quoted price â”€â”€ */}
        <View style={styles.earningBanner}>
          <Text style={styles.earningLabel}>Price</Text>
          <Text style={styles.earningAmount}>
            {job.price_estimate != null ? inr(job.price_estimate) : "Set on completion"}
          </Text>
          <Text style={styles.earningNote}>You enter the final amount when the job is done</Text>
        </View>

        {/* â”€â”€ Vehicle Info â”€â”€ */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleIconWrap}>
              <Ionicons name="car-sport" size={24} color={Colors.secondary} />
            </View>
            <View>
              <Text style={styles.vehicleName}>
                {job.vehicle_number ?? "Registration not provided"}
              </Text>
              <Text style={styles.vehiclePlate}>
                {job.service_name ?? "Service details unavailable"}
              </Text>
              {job.issue_description ? (
                <Text style={styles.vehicleColor}>"{job.issue_description}"</Text>
              ) : null}
            </View>
          </View>
        </Card>

        {/* â”€â”€ Service Info â”€â”€ */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Service required</Text>
          <View style={styles.serviceRow}>
            <View style={[styles.serviceIcon, { backgroundColor: meta.bg }]}>
              <Ionicons name={meta.icon as any} size={20} color={meta.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.serviceName}>
                {job.service_name ?? meta.label}
              </Text>
              <Text style={styles.serviceNotes}>
                {job.service_code ?? "Service code unavailable"}
              </Text>
            </View>
          </View>
        </Card>

        {/* â”€â”€ Location Details â”€â”€ */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Location details</Text>
          <View style={styles.routeRow}>
            <View style={styles.routeLeft}>
              <View style={[styles.routeDot, { backgroundColor: Colors.primary }]} />
              <View style={styles.routeLine} />
              <View style={[styles.routeDot, { backgroundColor: Colors.secondary }]} />
            </View>
            <View style={styles.routeRight}>
              <View style={styles.routeItem}>
                <Text style={styles.routeLabel}>Your current position</Text>
                <Text style={styles.routeAddress}>
                  Not included with the offer
                </Text>
              </View>
              <View style={[styles.routeItem, { marginTop: Spacing.base }]}>
                <Text style={styles.routeLabel}>Customer location</Text>
                <Text style={styles.routeAddress}>
                  {job.pickup_address_text ?? "Address not provided"}
                </Text>
              </View>
            </View>
          </View>
          {(distanceLabel || etaLabel) && (
            <View style={styles.routeStats}>
              {distanceLabel && (
                <View style={styles.routeStat}>
                  <Ionicons name="navigate-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.routeStatText}>{distanceLabel} away at offer time</Text>
                </View>
              )}
              {etaLabel && (
                <View style={styles.routeStat}>
                  <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.routeStatText}>{etaLabel}</Text>
                </View>
              )}
            </View>
          )}
        </Card>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* â”€â”€ Action Panel (Figma: bottom-panel + action-button-row) â”€â”€ */}
      <Animated.View
        style={[
          styles.bottomPanel,
          Shadows.sheet as ViewStyle,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.actionRow}>
          <Button
            label={declining ? "Decliningâ€¦" : "Decline"}
            onPress={handleDecline}
            loading={declining}
            variant="ghost"
            style={styles.declineBtn}
            textStyle={{ color: Colors.error }}
            fullWidth={false}
          />
          <Button
            label={accepting ? "Acceptingâ€¦" : "Accept Job  âœ“"}
            onPress={handleAccept}
            loading={accepting}
            variant="primary"
            style={styles.acceptBtn}
            fullWidth={false}
          />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
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

  timerBarBg: {
    height: 3,
    backgroundColor: Colors.border,
    width: "100%",
  },
  timerBar: {
    height: 3,
    borderRadius: 2,
  },

  alertHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.offerAlertBg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.offerAlertBorder,
  },
  alertLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  alertIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  alertSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  timerCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 2.5,
    borderColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  timerText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primaryDark,
  },

  earningBanner: {
    backgroundColor: Colors.secondary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: "center",
    marginBottom: Spacing.base,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  earningLabel: {
    fontSize: Typography.fontSize.base,
    color: "rgba(255,255,255,0.7)",
    fontFamily: Typography.fontFamily.regular,
  },
  earningAmount: {
    fontSize: Typography.fontSize["3xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
  },
  earningNote: {
    fontSize: Typography.fontSize.base,
    color: "rgba(255,255,255,0.7)",
    fontFamily: Typography.fontFamily.regular,
  },

  card: { marginBottom: Spacing.sm, gap: 10 },
  cardLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehiclePlate: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  vehicleColor: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
    textTransform: "capitalize",
  },

  serviceRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  serviceIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  serviceNotes: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    fontStyle: "italic",
    lineHeight: 20,
  },

  routeRow: { flexDirection: "row", gap: 16 },
  routeLeft: { alignItems: "center", paddingTop: 4 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: Colors.border, marginVertical: 4 },
  routeRight: { flex: 1 },
  routeItem: {},
  routeLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  routeAddress: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  routeStats: {
    flexDirection: "row",
    gap: Spacing.base,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
  },
  routeStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  routeStatText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
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
    height: 52,
  },
  acceptBtn: {
    flex: 2,
    height: 52,
  },
});

