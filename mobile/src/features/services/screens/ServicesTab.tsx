import React, { useMemo } from "react";
import { HeroScrollView } from "../../../components/ui/CollapsingHero";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Typography, Radius, Spacing, ServiceConfig } from "../../../constants/theme";
import type { OwnerStackParamList, ServiceType } from "../../../types";
import Card from "../../../components/ui/Card";
import ServiceArt, { artForService, type ArtName } from "../../../components/illustrations/ServiceArt";
import { SectionHeader, ErrorState, Skeleton, EmptyState } from "../../../components/ui/kit";
import { useCatalogue } from "../../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList>;
type IconName = keyof typeof Ionicons.glyphMap;

// Plain-language symptoms mapped to the service group that usually fixes them.
// A starting point to tap, not a diagnosis: the partner confirms on site.
const SYMPTOMS: { label: string; icon: IconName; type: ServiceType }[] = [
  { label: "Flat or punctured tyre", icon: "disc-outline", type: "tyre" },
  { label: "Car will not start", icon: "battery-dead-outline", type: "battery" },
  { label: "Cannot drive it (accident, breakdown)", icon: "car-outline", type: "towing" },
  { label: "Strange noise or warning light", icon: "construct-outline", type: "mechanic" },
];

// Which group a catalogue code belongs to, so tapping a service opens the flow on it.
const CODE_TO_TYPE: Record<string, ServiceType> = {
  flatbed_towing: "towing",
  wheel_lift_towing: "towing",
  battery_jumpstart: "battery",
  flat_tyre: "tyre",
  minor_repair: "mechanic",
};

export default function ServicesTab() {
  const nav = useNavigation<Nav>();
  const { data, isLoading, isError, refetch } = useCatalogue();

  const start = (serviceType?: ServiceType) => nav.navigate("OwnerFlow", { initialStep: "service_select", serviceType });

  const grouped = useMemo(() => {
    const out: Record<string, NonNullable<typeof data>> = {};
    for (const s of data ?? []) (out[s.category_name ?? "Roadside services"] ||= []).push(s);
    return out;
  }, [data]);

  return (
    <HeroScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      <View>
        <SectionHeader title="What happened?" />
        <View style={styles.symGrid}>
          {SYMPTOMS.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => start(s.type)}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              style={({ pressed }) => [styles.symCard, pressed && { transform: [{ scale: 0.97 }] }]}
            >
              <View style={[styles.symArt, { backgroundColor: ServiceConfig[s.type].bg }]}>
                <ServiceArt name={s.type as ArtName} fill />
              </View>
              <Text style={styles.symText} numberOfLines={3}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View>
        <SectionHeader title="All services" />
        {isLoading ? (
          <View style={{ gap: Spacing.md }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </View>
        ) : isError ? (
          <ErrorState message="We could not load the list of services." onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon="construct-outline" title="No services listed yet" message="You can still send a request from the Home tab." />
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <View key={category} style={{ marginBottom: Spacing.base }}>
              <Text style={styles.groupTitle}>{category}</Text>
              <View style={{ gap: Spacing.md }}>
                {items.map((s) => (
                  <View key={s.id} style={styles.svcCard}>
                    <View style={styles.svcTop}>
                      <View style={[styles.svcArt, { backgroundColor: ServiceConfig[CODE_TO_TYPE[s.code] ?? "mechanic"].bg }]}>
                        <ServiceArt name={artForService(s.code)} fill />
                      </View>
                      <View style={{ flex: 1, gap: 6 }}>
                        <Text style={styles.svcName}>{s.name}</Text>
                        <View style={styles.badge}>
                          <Ionicons name="shield-checkmark" size={13} color="#15803D" />
                          <Text style={styles.badgeText}>Verified partners</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.svcBottom}>
                      <View>
                        <Text style={styles.fromLabel}>{s.base_price != null ? "Starting from" : "Price"}</Text>
                        <Text style={styles.fromValue}>{s.base_price != null ? `₹${Number(s.base_price).toLocaleString("en-IN")}` : "On site"}</Text>
                      </View>
                      <Pressable
                        onPress={() => start(CODE_TO_TYPE[s.code])}
                        accessibilityRole="button"
                        accessibilityLabel={`Request ${s.name}`}
                        style={({ pressed }) => [styles.reqBtn, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={styles.reqText}>Request</Text>
                        <Ionicons name="arrow-forward" size={18} color="#fff" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
        <Text style={styles.note}>Final price is confirmed when the job is completed.</Text>
      </View>
    </HeroScrollView>
  );
}

const styles = StyleSheet.create({
  symGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  symCard: { width: "47%", flexGrow: 1, padding: Spacing.sm, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  symArt: { height: 96, borderRadius: Radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  symText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, paddingHorizontal: 4, paddingBottom: 4 },
  svcCard: { padding: Spacing.base, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md },
  svcTop: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  svcArt: { width: 92, height: 72, borderRadius: Radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  svcName: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: "#15803D" },
  svcBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.md },
  fromLabel: { fontSize: Typography.fontSize.xs, color: Colors.textMuted, fontFamily: Typography.fontFamily.medium },
  fromValue: { fontSize: Typography.fontSize["2xl"], color: Colors.textPrimary, fontFamily: Typography.fontFamily.bold },
  reqBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: Spacing.lg, borderRadius: 999, backgroundColor: "#047857" },
  reqText: { color: "#fff", fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.bold },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] + 40 },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  symptom: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.base, minHeight: 60 },
  symptomIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  symptomText: { flex: 1, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary, marginLeft: 0 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  groupTitle: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: Typography.letterSpacing.wide, marginBottom: Spacing.sm },
  note: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
});
