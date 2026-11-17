import React, { useMemo } from "react";
import { HeroScrollView } from "../../../components/ui/CollapsingHero";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Typography, Radius, Spacing } from "../../../constants/theme";
import type { OwnerStackParamList, ServiceType } from "../../../types";
import Card from "../../../components/ui/Card";
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
        <Card noPad>
          {SYMPTOMS.map((s, i) => (
            <Pressable
              key={s.label}
              onPress={() => start(s.type)}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              style={({ pressed }) => [styles.symptom, i < SYMPTOMS.length - 1 && styles.divider, pressed && { backgroundColor: Colors.borderLight }]}
            >
              <View style={styles.symptomIcon}>
                <Ionicons name={s.icon} size={22} color={Colors.brand700} />
              </View>
              <Text style={styles.symptomText}>{s.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </Card>
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
              <Card noPad>
                {items.map((s, i) => (
                  <Pressable
                    key={s.id}
                    onPress={() => start(CODE_TO_TYPE[s.code])}
                    accessibilityRole="button"
                    accessibilityLabel={`Request ${s.name}`}
                    style={({ pressed }) => [styles.symptom, i < items.length - 1 && styles.divider, pressed && { backgroundColor: Colors.borderLight }]}
                  >
                    <Text style={[styles.symptomText, { marginLeft: 0 }]}>{s.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  </Pressable>
                ))}
              </Card>
            </View>
          ))
        )}
        <Text style={styles.note}>Final price is confirmed when the job is completed.</Text>
      </View>
    </HeroScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] + 40 },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  symptom: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.base, minHeight: 60 },
  symptomIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  symptomText: { flex: 1, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary, marginLeft: 0 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  groupTitle: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: Typography.letterSpacing.wide, marginBottom: Spacing.sm },
  note: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
});
