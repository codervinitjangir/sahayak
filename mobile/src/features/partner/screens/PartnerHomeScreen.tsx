// ─── Sahayak — Partner Home Screen ───────────────────────────────────────────
// Figma: partner-home — header, online toggle, stats, history
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  StatusBar,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Spacing, Radius, Shadows, ServiceConfig } from "../../../constants/theme";
import Avatar from "../../../components/ui/Avatar";
import Card from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/Badge";
import { useAuthStore } from "../../../store/authStore";
import { useJobStore } from "../../../store/jobStore";
import { MOCK_PARTNER, MOCK_JOBS } from "../../../services/api";
import type { PartnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "PartnerHome">;

export default function PartnerHomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const { isOnline, setOnline } = useJobStore();

  const partner = MOCK_PARTNER;
  const recentJobs = MOCK_JOBS;

  const toggleOnline = (val: boolean) => {
    setOnline(val);
  };

  const statsCards = [
    { label: "Today's Earnings", value: `₹${partner.earningsToday}`, icon: "wallet", color: Colors.success, bg: Colors.successLight },
    { label: "Jobs Today", value: "5", icon: "briefcase", color: Colors.info, bg: Colors.infoLight },
    { label: "Rating", value: `${partner.rating}⭐`, icon: "star", color: Colors.primary, bg: Colors.primaryLight },
    { label: "Total Earned", value: `₹${(partner.earningsTotal! / 1000).toFixed(1)}K`, icon: "trending-up", color: Colors.secondary, bg: Colors.borderLight },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Partner Header (Figma: partner-header) ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Avatar name={user?.name ?? partner.name} size={48} showOnline isOnline={isOnline} />
            <View>
              <Text style={styles.partnerName}>{user?.name ?? partner.name}</Text>
              <View style={styles.verifiedRow}>
                <Ionicons name="shield-checkmark" size={13} color={Colors.info} />
                <Text style={styles.verifiedText}>Verified Partner</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.notifBtn}>
            <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* ── Online Toggle (Figma: toggle-container) ── */}
        <Card
          style={[
            styles.toggleCard,
            { borderColor: isOnline ? Colors.success : Colors.border },
          ] as any}
          bg={isOnline ? Colors.successLight : Colors.surface}
        >
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleTitle}>
                {isOnline ? "You're Online 🟢" : "You're Offline ⚫"}
              </Text>
              <Text style={styles.toggleSubtitle}>
                {isOnline
                  ? "Accepting job requests"
                  : "Toggle to start receiving jobs"}
              </Text>
            </View>
            <Switch
              value={isOnline}
              onValueChange={toggleOnline}
              trackColor={{ false: Colors.shimmerBase, true: Colors.success }}
              thumbColor={Colors.textWhite}
              ios_backgroundColor={Colors.shimmerBase}
            />
          </View>
        </Card>

        {/* ── Stats Grid (Figma: stats-container) ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Performance</Text>
          <View style={styles.statsGrid}>
            {statsCards.map((stat) => (
              <Card key={stat.label} style={styles.statCard} bg={stat.bg} noPad>
                <View style={styles.statInner}>
                  <View style={[styles.statIcon, { backgroundColor: stat.bg }]}>
                    <Ionicons name={stat.icon as any} size={18} color={stat.color} />
                  </View>
                  <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              </Card>
            ))}
          </View>
        </View>

        {/* ── Incoming Job Demo Button ── */}
        {isOnline && (
          <TouchableOpacity
            style={[styles.incomingBanner, Shadows.button as ViewStyle]}
            onPress={() => nav.navigate("IncomingOffer", { jobId: "job_003" })}
            activeOpacity={0.85}
          >
            <View style={styles.incomingLeft}>
              <View style={styles.incomingPulse}>
                <Ionicons name="flash" size={20} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.incomingTitle}>New Job Available!</Text>
                <Text style={styles.incomingSubtitle}>Battery Jump Start · 2.1 km away · ₹299</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textWhite} />
          </TouchableOpacity>
        )}

        {/* ── Services Offered ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services Offered</Text>
          <View style={styles.servicesRow}>
            {partner.services.map((svc) => {
              const cfg = ServiceConfig[svc];
              return (
                <View key={svc} style={[styles.serviceTag, { backgroundColor: cfg.bg }]}>
                  <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
                  <Text style={[styles.serviceTagText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Job History (Figma: history-container) ── */}
        <View style={[styles.section, { marginBottom: Spacing["3xl"] }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Jobs</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          {recentJobs.map((job) => {
            const svc = ServiceConfig[job.serviceType];
            return (
              <Card key={job.id} style={styles.historyCard} noPad>
                <View style={styles.historyInner}>
                  <View style={[styles.historyIcon, { backgroundColor: svc.bg }]}>
                    <Ionicons name={svc.icon as any} size={18} color={svc.color} />
                  </View>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyService}>{svc.label}</Text>
                    <Text style={styles.historyAddress} numberOfLines={1}>
                      {job.pickupLocation.address}
                    </Text>
                  </View>
                  <View style={styles.historyRight}>
                    <StatusBadge status={job.status} />
                    {job.finalPrice && (
                      <Text style={styles.historyEarning}>+₹{job.finalPrice}</Text>
                    )}
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { paddingBottom: 20 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  partnerName: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  verifiedText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.info,
    fontFamily: Typography.fontFamily.medium,
  },
  notifBtn: { padding: 4 },

  toggleCard: {
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    borderWidth: 1.5,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  toggleSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },

  section: { paddingHorizontal: Spacing.lg, marginTop: Spacing.base },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  seeAll: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  statCard: {
    width: "47.5%",
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  statInner: {
    padding: Spacing.base,
    alignItems: "flex-start",
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
  },
  statLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },

  incomingBanner: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.secondary,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  incomingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  incomingPulse: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  incomingTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  incomingSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: "rgba(255,255,255,0.7)",
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },

  servicesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  serviceTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  serviceTagText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.medium,
  },

  historyCard: { marginBottom: Spacing.sm },
  historyInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.base,
    gap: 12,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  historyInfo: { flex: 1 },
  historyService: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  historyAddress: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  historyRight: { alignItems: "flex-end", gap: 6 },
  historyEarning: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.success,
  },
});

