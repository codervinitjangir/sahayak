// ─── Sahayak — Owner Home Screen ─────────────────────────────────────────────
// Figma: owner-home — Brand bar, vehicle card, service grid, history
import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import { ServiceConfig } from "../../../constants/theme";
import Avatar from "../../../components/ui/Avatar";
import { StatusBadge } from "../../../components/ui/Badge";
import ServiceGrid from "../../../components/ui/ServiceGrid";
import Card from "../../../components/ui/Card";
import { useAuthStore } from "../../../store/authStore";
import { MOCK_VEHICLES, MOCK_JOBS } from "../../../services/api";
import type { OwnerStackParamList, ServiceType } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "OwnerHome">;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = React.useState(false);

  const vehicle = MOCK_VEHICLES[0];
  const recentJobs = MOCK_JOBS.slice(0, 3);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }, []);

  const handleServiceSelect = (service: ServiceType) => {
    nav.navigate("ServiceSelect", { vehicleId: vehicle.id });
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    return "Good Evening";
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* ── Brand Bar (Figma: brand-bar) ── */}
        <View style={styles.brandBar}>
          <View>
            <Text style={styles.greeting}>{greeting()},</Text>
            <Text style={styles.userName}>{user?.name?.split(" ")[0] ?? "there"} 👋</Text>
          </View>
          <View style={styles.brandRight}>
            <TouchableOpacity style={styles.notifBtn}>
              <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
              <View style={styles.notifDot} />
            </TouchableOpacity>
            <Avatar name={user?.name ?? "U"} size={42} />
          </View>
        </View>

        {/* ── SOS Emergency Banner ── */}
        <TouchableOpacity
          style={[styles.sosBanner, Shadows.button as ViewStyle]}
          onPress={() => handleServiceSelect("mechanic")}
          activeOpacity={0.85}
        >
          <View style={styles.sosLeft}>
            <View style={styles.sosPulse}>
              <Text style={styles.sosIcon}>🆘</Text>
            </View>
            <View>
              <Text style={styles.sosTitle}>Emergency Assistance</Text>
              <Text style={styles.sosSubtitle}>Tap for immediate help</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textWhite} />
        </TouchableOpacity>

        {/* ── Vehicle Card (Figma: vehicle-container) ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Vehicle</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>Manage</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.vehicleCard} noPad>
            <View style={styles.vehicleInner}>
              <View style={styles.vehicleLeft}>
                <View style={styles.vehicleIconBg}>
                  <Ionicons
                    name={vehicle.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={30}
                    color={Colors.primary}
                  />
                </View>
                <View>
                  <Text style={styles.vehicleName}>
                    {vehicle.make} {vehicle.model}
                  </Text>
                  <Text style={styles.vehiclePlate}>{vehicle.licensePlate}</Text>
                  <View style={styles.vehicleTags}>
                    <View style={styles.tag}>
                      <Text style={styles.tagText}>{vehicle.year}</Text>
                    </View>
                    <View style={styles.tag}>
                      <Text style={styles.tagText}>{vehicle.fuelType}</Text>
                    </View>
                  </View>
                </View>
              </View>
              <TouchableOpacity style={styles.addVehicleBtn}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Health bar */}
            <View style={styles.healthBar}>
              <View style={styles.healthItem}>
                <Ionicons name="water-outline" size={14} color={Colors.success} />
                <Text style={styles.healthLabel}>Fuel OK</Text>
              </View>
              <View style={styles.healthDivider} />
              <View style={styles.healthItem}>
                <Ionicons name="battery-half-outline" size={14} color={Colors.primary} />
                <Text style={styles.healthLabel}>Battery 78%</Text>
              </View>
              <View style={styles.healthDivider} />
              <View style={styles.healthItem}>
                <Ionicons name="disc-outline" size={14} color={Colors.info} />
                <Text style={styles.healthLabel}>Tyres Good</Text>
              </View>
            </View>
          </Card>
        </View>

        {/* ── Service Grid (Figma: grid-container) ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Request Help</Text>
          </View>
          <ServiceGrid onSelect={handleServiceSelect} />
        </View>

        {/* ── Promo Banner ── */}
        <Card style={styles.promoBanner} bg={Colors.primaryMuted} noPad>
          <View style={styles.promoInner}>
            <View style={styles.promoLeft}>
              <Text style={styles.promoTag}>LIMITED OFFER</Text>
              <Text style={styles.promoTitle}>First service FREE!</Text>
              <Text style={styles.promoSub}>Use code: SAHAYAK1ST</Text>
            </View>
            <Text style={styles.promoEmoji}>🎁</Text>
          </View>
        </Card>

        {/* ── Recent History (Figma: history-container) ── */}
        <View style={[styles.section, { marginBottom: Spacing["3xl"] }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Requests</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          {recentJobs.length === 0 ? (
            <Card>
              <View style={styles.emptyHistory}>
                <Ionicons name="car-outline" size={40} color={Colors.shimmerBase} />
                <Text style={styles.emptyText}>No requests yet</Text>
              </View>
            </Card>
          ) : (
            recentJobs.map((job) => {
              const svc = ServiceConfig[job.serviceType];
              return (
                <Card key={job.id} style={styles.historyCard} noPad>
                  <View style={styles.historyInner}>
                    <View style={[styles.historyIcon, { backgroundColor: svc.bg }]}>
                      <Ionicons name={svc.icon as any} size={20} color={svc.color} />
                    </View>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyService}>{svc.label}</Text>
                      <Text style={styles.historyAddress} numberOfLines={1}>
                        {job.pickupLocation.address}
                      </Text>
                      <Text style={styles.historyDate}>
                        {new Date(job.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </Text>
                    </View>
                    <View style={styles.historyRight}>
                      <StatusBadge status={job.status} />
                      {job.finalPrice && (
                        <Text style={styles.historyPrice}>₹{job.finalPrice}</Text>
                      )}
                    </View>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { paddingBottom: 20 },

  brandBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  greeting: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  userName: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  brandRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  notifBtn: { position: "relative" },
  notifDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },

  sosBanner: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.secondary,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sosLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  sosPulse: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(239,68,68,0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(239,68,68,0.5)",
  },
  sosIcon: { fontSize: 20 },
  sosTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  sosSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: "rgba(255,255,255,0.65)",
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },

  section: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  seeAll: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },

  vehicleCard: { borderRadius: Radius.lg, overflow: "hidden" },
  vehicleInner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: Spacing.base,
  },
  vehicleLeft: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  vehicleIconBg: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  vehiclePlate: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 6,
  },
  vehicleTags: { flexDirection: "row", gap: 6 },
  tag: {
    backgroundColor: Colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  tagText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
    textTransform: "capitalize",
  },
  addVehicleBtn: { padding: 4 },
  healthBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
  },
  healthItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, justifyContent: "center" },
  healthLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
  },
  healthDivider: { width: 1, backgroundColor: Colors.border, height: "100%" },

  promoBanner: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.base,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
  },
  promoInner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.base,
  },
  promoLeft: { flex: 1 },
  promoTag: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  promoTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  promoSub: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  promoEmoji: { fontSize: 40, marginLeft: 12 },

  historyCard: { marginBottom: Spacing.sm },
  historyInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.base,
    gap: 12,
  },
  historyIcon: {
    width: 44,
    height: 44,
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
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginBottom: 2,
  },
  historyDate: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
  },
  historyRight: { alignItems: "flex-end", gap: 6 },
  historyPrice: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },

  emptyHistory: { alignItems: "center", paddingVertical: Spacing.xl, gap: 8 },
  emptyText: {
    fontSize: Typography.fontSize.base,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
  },
});

