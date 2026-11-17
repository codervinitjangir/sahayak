import React from "react";
import { HeroScrollView } from "../../components/ui/CollapsingHero";
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Typography, Radius, Spacing, ServiceConfig } from "../../constants/theme";
import type { OwnerStackParamList, ServiceType } from "../../types";
import Card from "../../components/ui/Card";
import ServiceArt, { type ArtName } from "../../components/illustrations/ServiceArt";
import ComingSoonServices from "./ComingSoonServices";
import { OWNER_COMING_SOON } from "./comingSoon";
import SafetyActions from "../../components/ui/SafetyActions";
import { SectionHeader, StatusChip, Skeleton, EmptyState } from "../../components/ui/kit";
import { useMyJobs, useMyVehicles, isActiveStatus, formatWhen } from "../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList>;

// Shortcuts into the request flow. Each maps to a service group the flow already
// understands; nothing here claims a price, an ETA or an availability.
const SHORTCUTS: ServiceType[] = ["tyre", "battery", "towing", "mechanic", "lockout"];
const ART: Record<string, ArtName> = { tyre: "tyre", battery: "battery", towing: "towing", mechanic: "mechanic", lockout: "lockout" };

export default function HomeTab({
  onOpenActivity,
  onOpenServices,
  onAddVehicle,
}: {
  onOpenActivity: () => void;
  onOpenServices: () => void;
  onAddVehicle: () => void;
}) {
  const nav = useNavigation<Nav>();
  const jobs = useMyJobs();
  const vehicles = useMyVehicles();

  const active = jobs.data?.find((j) => isActiveStatus(j.status));
  // The live request is shown by the floating ActiveRequestBar in the shell.
  const recent = (jobs.data ?? []).filter((j) => j !== active).slice(0, 3);
  const refreshing = jobs.isRefetching || vehicles.isRefetching;

  const startFlow = (serviceType?: ServiceType) =>
    nav.navigate("OwnerFlow", { initialStep: "service_select", serviceType });

  return (
    <HeroScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void jobs.refetch();
            void vehicles.refetch();
          }}
          tintColor={Colors.brand700}
        />
      }
    >
      <SafetyActions />

      {/* Quick services */}
      <View>
        <SectionHeader title="Quick services" />
        <View style={styles.grid}>
          {SHORTCUTS.map((t) => {
            const cfg = ServiceConfig[t];
            return (
              <Pressable
                key={t}
                onPress={() => startFlow(t)}
                accessibilityRole="button"
                accessibilityLabel={`Request ${cfg.label}`}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                <View style={[styles.tileArt, { backgroundColor: cfg.bg }]}>
                  <ServiceArt name={ART[t]} fill />
                </View>
                <Text style={styles.tileLabel} numberOfLines={2}>{cfg.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onOpenServices}
            accessibilityRole="button"
            accessibilityLabel="See all services"
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <View style={[styles.tileArt, { backgroundColor: Colors.brand700Muted }]}>
              <ServiceArt name="all" width={60} />
            </View>
            <Text style={styles.tileLabel}>All services</Text>
          </Pressable>
        </View>
      </View>

      <ComingSoonServices side="owner" items={OWNER_COMING_SOON} />

      {/* Instant help strip */}
      <Pressable
        onPress={() => startFlow("mechanic")}
        accessibilityRole="button"
        accessibilityLabel="Need help now? Get a mechanic"
        style={({ pressed }) => [styles.strip, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.stripArt}><ServiceArt name="partner" fill /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.stripKicker}>Need help now?</Text>
          <Text style={styles.stripTitle}>Get a mechanic</Text>
        </View>
        <View style={styles.stripGo}><Ionicons name="arrow-forward" size={20} color="#065F46" /></View>
      </Pressable>

      {/* Vehicles */}
      <View>
        <SectionHeader title="My vehicles" action="Add" onAction={onAddVehicle} />
        {vehicles.isLoading ? (
          <Skeleton height={96} />
        ) : vehicles.isError ? (
          <Card>
            <Text style={styles.muted}>Could not load your vehicles.</Text>
          </Card>
        ) : (vehicles.data ?? []).length === 0 ? (
          <Pressable onPress={onAddVehicle} accessibilityRole="button" accessibilityLabel="Add a vehicle" style={styles.addVehicle}>
            <ServiceArt name="car" width={96} />
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>Add your vehicle</Text>
              <Text style={styles.muted}>Save it once; it is ready whenever you need help.</Text>
            </View>
            <Ionicons name="add-circle" size={30} color={Colors.brand700} />
          </Pressable>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.md, paddingRight: 4 }}>
            {(vehicles.data ?? []).map((v) => (
              <View key={v.id} style={styles.vehicleCard}>
                <View style={styles.vehicleArt}>
                  <ServiceArt name={v.vehicle_type === "two_wheeler" ? "bike" : "car"} fill />
                </View>
                <Text style={styles.vehicleName} numberOfLines={1}>{v.make} {v.model}</Text>
                <View style={styles.plateBox}><Text style={styles.plate}>{v.vehicle_number}</Text></View>
              </View>
            ))}
            <Pressable onPress={onAddVehicle} accessibilityRole="button" accessibilityLabel="Add another vehicle" style={[styles.vehicleCard, styles.vehicleAdd]}>
              <Ionicons name="add" size={30} color={Colors.textSecondary} />
              <Text style={styles.muted}>Add vehicle</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>

      {/* Recent */}
      <View>
        <SectionHeader title="Recent requests" action={recent.length ? "See all" : undefined} onAction={onOpenActivity} />
        {jobs.isLoading ? (
          <Skeleton height={72} />
        ) : jobs.isError ? (
          <Card>
            <Text style={styles.muted}>Could not load your requests.</Text>
          </Card>
        ) : recent.length === 0 && !active ? (
          <Card>
            <EmptyState icon="time-outline" title="No requests yet" message="When you ask for help it will show up here, and you can follow it live." />
          </Card>
        ) : (
          <Card noPad>
            {recent.map((j, i) => (
              <Pressable
                key={j.id}
                onPress={onOpenActivity}
                accessibilityRole="button"
                style={[styles.recentRow, i < recent.length - 1 && styles.divider]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.vehicleName} numberOfLines={1}>
                    {j.service_name ?? "Roadside help"}
                  </Text>
                  <Text style={styles.muted}>{formatWhen(j.requested_at ?? j.created_at)}</Text>
                </View>
                <StatusChip status={j.status} />
              </Pressable>
            ))}
          </Card>
        )}
      </View>


      <View style={styles.footer} accessible accessibilityLabel="Never stranded. Made in India.">
        <Text style={styles.footerBig}>#Never{"\n"}Stranded</Text>
        <Text style={styles.footerSmall}>Made with ❤️ in India · Sahayak</Text>
      </View>
    </HeroScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] + 40 },
  hero: { backgroundColor: Colors.primaryDeep, borderRadius: Radius["2xl"], padding: Spacing.xl },
  heroEyebrow: { color: Colors.brand700Light, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold },
  heroTitle: { marginTop: 8, color: "#fff", fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, letterSpacing: Typography.letterSpacing.display },
  heroBody: { marginTop: 8, color: Colors.brand700Light, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.regular, lineHeight: 22 },

  activeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.brand700,
    backgroundColor: Colors.brand700Muted,
  },
  activeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  activeKicker: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700Dark },
  activeTitle: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  tile: { width: "30%", flexGrow: 1, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, alignItems: "center", gap: 8, padding: Spacing.sm, paddingBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  tileArt: { width: "100%", height: 84, borderRadius: Radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, textAlign: "center" },
  strip: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: "#047857" },
  stripArt: { width: 72, height: 60, borderRadius: Radius.lg, overflow: "hidden", backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  stripKicker: { color: "#A7F3D0", fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium },
  stripTitle: { color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold },
  stripGo: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" },
  addVehicle: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  vehicleCard: { width: 168, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  vehicleArt: { height: 96, borderRadius: Radius.lg, overflow: "hidden", backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  vehicleAdd: { alignItems: "center", justifyContent: "center", borderStyle: "dashed", width: 120 },
  plateBox: { alignSelf: "flex-start", borderWidth: 1.5, borderColor: Colors.textPrimary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "#FEFCE8" },
  footer: { paddingTop: Spacing.lg, paddingBottom: Spacing.base },
  footerBig: { fontSize: 44, lineHeight: 50, fontFamily: Typography.fontFamily.bold, color: "#CBD5E1", letterSpacing: -1 },
  footerSmall: { marginTop: Spacing.md, fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.medium },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, minHeight: 64 },
  vehicleIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  plate: { marginTop: 2, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium, color: Colors.textSecondary, letterSpacing: 0.6 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  recentRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, minHeight: 64 },
  muted: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
});
