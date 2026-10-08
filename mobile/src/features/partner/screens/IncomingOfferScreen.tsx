// ─── Sahayak — Incoming Offer Screen (Partner) ───────────────────────────────
// Figma: partner-incoming-offer — orange alert header, job details, Accept/Decline
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  StatusBar,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows, ServiceConfig } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { MOCK_INCOMING_OFFER } from "../../../services/api";
import { jobsApi } from "../../../services/api/jobs";
import type { PartnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "IncomingOffer">;
type Route = RouteProp<PartnerStackParamList, "IncomingOffer">;

export default function IncomingOfferScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const offer = MOCK_INCOMING_OFFER;
  const job = offer.job;
  const svc = ServiceConfig[job.serviceType];

  const offerData = route.params?.offerData;
  const offeredAt = offerData?.offered_at;
  const [relativeAge, setRelativeAge] = useState<string>("Just now");
  const [accepting, setAccepting] = useState(false);
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

  const handleAccept = async () => {
    setAccepting(true);
    const assignmentId = route.params?.assignmentId || route.params?.jobId;
    try {
      if (assignmentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignmentId)) {
        await jobsApi.respondToAssignment(assignmentId, "accept");
      }
      nav.navigate("ActiveJob", { jobId: route.params.jobId });
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === "PARTNER_AT_CAPACITY") {
        Alert.alert(
          "Limit Reached",
          "You are at your concurrent job limit (2 jobs max). Complete an existing job to accept this one."
        );
      } else if (code === "ASSIGNMENT_ALREADY_ANSWERED") {
        Alert.alert(
          "Offer Expired",
          "This job is no longer available or was taken by another technician.",
          [{ text: "OK", onPress: () => nav.goBack() }]
        );
      } else {
        nav.navigate("ActiveJob", { jobId: route.params.jobId });
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    const assignmentId = route.params?.assignmentId || route.params?.jobId;
    if (assignmentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignmentId)) {
      try {
        await jobsApi.respondToAssignment(assignmentId, "reject", "Partner declined");
      } catch {
        // ignore
      }
    }
    nav.goBack();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* ── Alert Header (Figma: offer-alert-header — bg #FFFCF0) ── */}
      <View style={styles.alertHeader}>
        <View style={styles.alertLeft}>
          <View style={styles.alertIconWrap}>
            <Ionicons name="flash" size={24} color={Colors.primary} />
          </View>
          <View>
            <Text style={styles.alertTitle}>New Breakdown Offer!</Text>
            <Text style={styles.alertSubtitle}>
              {offeredAt ? `Offered ${relativeAge}` : "Live Roadside Dispatch"}
            </Text>
          </View>
        </View>
        <View style={styles.timerCircle}>
          <Ionicons name="radio" size={14} color="#0C831F" />
          <Text style={[styles.timerText, { color: "#0C831F", fontSize: 12 }]}>LIVE</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Earnings highlight ── */}
        <View style={styles.earningBanner}>
          <Text style={styles.earningLabel}>You'll earn</Text>
          <Text style={styles.earningAmount}>₹{offer.estimatedEarning}</Text>
          <Text style={styles.earningNote}>for this job</Text>
        </View>

        {/* ── Vehicle Info (Figma: section-vehicle) ── */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleIconWrap}>
              <Ionicons
                name={job.vehicle?.type === "two-wheeler" ? "bicycle" : "car-sport"}
                size={24}
                color={Colors.secondary}
              />
            </View>
            <View>
              <Text style={styles.vehicleName}>
                {job.vehicle?.make} {job.vehicle?.model} ({job.vehicle?.year})
              </Text>
              <Text style={styles.vehiclePlate}>{job.vehicle?.licensePlate}</Text>
              <Text style={styles.vehicleColor}>{job.vehicle?.color} · {job.vehicle?.fuelType}</Text>
            </View>
          </View>
        </Card>

        {/* ── Service Info (Figma: section-subservice) ── */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Service Required</Text>
          <View style={styles.serviceRow}>
            <View style={[styles.serviceIcon, { backgroundColor: svc.bg }]}>
              <Ionicons name={svc.icon as any} size={20} color={svc.color} />
            </View>
            <View>
              <Text style={styles.serviceName}>{svc.label}</Text>
              {job.notes && (
                <Text style={styles.serviceNotes}>"{job.notes}"</Text>
              )}
            </View>
          </View>
        </Card>

        {/* ── Route Preview (Figma: section-route-preview) ── */}
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>Location Details</Text>
          <View style={styles.routeRow}>
            <View style={styles.routeLeft}>
              <View style={[styles.routeDot, { backgroundColor: Colors.primary }]} />
              <View style={styles.routeLine} />
              <View style={[styles.routeDot, { backgroundColor: Colors.secondary }]} />
            </View>
            <View style={styles.routeRight}>
              <View style={styles.routeItem}>
                <Text style={styles.routeLabel}>Your Current Location</Text>
                <Text style={styles.routeAddress}>Indiranagar, Bengaluru</Text>
              </View>
              <View style={[styles.routeItem, { marginTop: Spacing.base }]}>
                <Text style={styles.routeLabel}>Customer Location</Text>
                <Text style={styles.routeAddress}>
                  {job.pickupLocation.address}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.routeStats}>
            <View style={styles.routeStat}>
              <Ionicons name="navigate-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.routeStatText}>{offer.distanceKm} km away</Text>
            </View>
            <View style={styles.routeStat}>
              <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.routeStatText}>{offer.etaMinutes} min ETA</Text>
            </View>
          </View>
        </Card>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Action Panel (Figma: bottom-panel + action-button-row) ── */}
      <Animated.View
        style={[
          styles.bottomPanel,
          Shadows.sheet as ViewStyle,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.actionRow}>
          <Button
            label="Decline"
            onPress={handleDecline}
            variant="ghost"
            style={styles.declineBtn}
            textStyle={{ color: Colors.error }}
            fullWidth={false}
          />
          <Button
            label={accepting ? "Accepting…" : "Accept Job  ✓"}
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

