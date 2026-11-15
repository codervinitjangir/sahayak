import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Typography, Radius, Spacing, ServiceConfig } from "../../constants/theme";
import type { OwnerStackParamList, ServiceType } from "../../types";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import SafetyActions from "../../components/ui/SafetyActions";
import { SectionHeader, StatusChip, Skeleton, EmptyState } from "../../components/ui/kit";
import { useMyJobs, useMyVehicles, isActiveStatus, formatWhen } from "../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList>;

// Shortcuts into the request flow. Each maps to a service group the flow already
// understands; nothing here claims a price, an ETA or an availability.
const SHORTCUTS: ServiceType[] = ["tyre", "battery", "fuel", "towing", "mechanic", "lockout"];

export default function HomeTab({
  onOpenActivity,
  onAddVehicle,
}: {
  onOpenActivity: () => void;
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
    <ScrollView
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
      {/* Primary action */}
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>Roadside assistance in Bengaluru</Text>
        <Text style={styles.heroTitle} accessibilityRole="header">
          Stranded on the road?
        </Text>
        <Text style={styles.heroBody}>
          Tell us where you are and what happened. We will match you with a verified partner nearby.
        </Text>
        <View style={{ marginTop: Spacing.lg }}>
          <Button
            label="Request help"
            onPress={() => startFlow()}
            style={{ backgroundColor: "#FFFFFF" }}
            textStyle={{ color: Colors.primaryDeep }}
            icon={<Ionicons name="medkit-outline" size={22} color={Colors.primaryDeep} />}
          />
        </View>
      </View>

      <SafetyActions />

      {/* Shortcuts */}
      <View>
        <SectionHeader title="What do you need?" />
        <View style={styles.grid}>
          {SHORTCUTS.map((t) => {
            const cfg = ServiceConfig[t];
            return (
              <Pressable
                key={t}
                onPress={() => startFlow(t)}
                accessibilityRole="button"
                accessibilityLabel={`Request ${cfg.label}`}
                style={({ pressed }) => [styles.tile, pressed && { backgroundColor: Colors.borderLight }]}
              >
                <View style={[styles.tileIcon, { backgroundColor: cfg.bg }]}>
                  <Ionicons name={cfg.icon as keyof typeof Ionicons.glyphMap} size={26} color={cfg.color} />
                </View>
                <Text style={styles.tileLabel}>{cfg.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Vehicles */}
      <View>
        <SectionHeader title="My vehicles" action="Add" onAction={onAddVehicle} />
        {vehicles.isLoading ? (
          <Skeleton height={72} />
        ) : vehicles.isError ? (
          <Card>
            <Text style={styles.muted}>Could not load your vehicles.</Text>
          </Card>
        ) : (vehicles.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon="car-outline"
              title="No vehicles yet"
              message="Add your vehicle once and it is ready whenever you need help."
              actionLabel="Add a vehicle"
              onAction={onAddVehicle}
            />
          </Card>
        ) : (
          <Card noPad>
            {(vehicles.data ?? []).map((v, i, arr) => (
              <View key={v.id} style={[styles.vehicleRow, i < arr.length - 1 && styles.divider]}>
                <View style={styles.vehicleIcon}>
                  <Ionicons name={v.vehicle_type === "two_wheeler" ? "bicycle-outline" : "car-outline"} size={22} color={Colors.brand700} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>
                    {v.make} {v.model}
                  </Text>
                  <Text style={styles.plate}>{v.vehicle_number}</Text>
                </View>
              </View>
            ))}
          </Card>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] },
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
  tile: {
    width: "30%",
    flexGrow: 1,
    minHeight: 104,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: Spacing.md,
  },
  tileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, textAlign: "center" },

  vehicleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, minHeight: 64 },
  vehicleIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  plate: { marginTop: 2, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium, color: Colors.textSecondary, letterSpacing: 0.6 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  recentRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, minHeight: 64 },
  muted: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
});
