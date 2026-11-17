// Verification status: same content as the web partner console's page, for
// partners who only use a phone. Status comes from GET /partners/me/stats.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing, Typography, Radius } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { ErrorState, Skeleton } from "../../../components/ui/kit";
import { useJobStore } from "../../../store/jobStore";
import { partnerApi, type MobilePartnerService, type MobilePartnerTrustStats } from "../../../services/api/partner";

type IconName = keyof typeof Ionicons.glyphMap;

function metaFor(status?: string): { title: string; body: string; icon: IconName; color: string; bg: string } {
  switch (status) {
    case "verified":
      return { title: "You are verified", body: "The Sahayak team has verified your account. Go on duty to receive job offers.", icon: "shield-checkmark", color: Colors.success, bg: Colors.successLight };
    case "rejected":
      return { title: "Not approved", body: "The Sahayak team could not verify your account. Call support to find out why and what to send.", icon: "close-circle", color: Colors.error, bg: Colors.errorLight };
    case "suspended":
      return { title: "Account suspended", body: "You will not receive jobs while suspended. Call support for details.", icon: "pause-circle", color: Colors.error, bg: Colors.errorLight };
    default:
      return { title: "Verification pending", body: "The Sahayak team verifies every partner before they can receive jobs. You do not need to do anything else right now.", icon: "time", color: Colors.warning, bg: Colors.warningLight };
  }
}

export default function PartnerVerificationScreen() {
  const navigation = useNavigation<any>();
  const isOnline = useJobStore((s) => s.isOnline);
  const [stats, setStats] = useState<MobilePartnerTrustStats | null>(null);
  const [services, setServices] = useState<MobilePartnerService[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [s, sv] = await Promise.all([partnerApi.getStats(), partnerApi.getServices()]);
      setStats(s);
      setServices(sv.services ?? []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const status = stats?.verification_status;
  const meta = metaFor(status);
  const verified = status === "verified";
  const steps = [
    { label: "You registered", done: true },
    { label: "The Sahayak team reviews your account", done: verified || status === "rejected" || status === "suspended" },
    { label: "You go on duty and receive offers", done: verified && isOnline },
  ];

  return (
    <View style={styles.root}>
      <ScreenHero title="Verification" left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }} />
      {failed && !stats ? (
        <ErrorState message="Could not load your verification status." onRetry={() => void load()} />
      ) : !stats ? (
        <View style={styles.pad}><Skeleton height={120} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.pad, { gap: Spacing.lg }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={Colors.brand700} />}
        >
          <View style={[styles.status, { backgroundColor: meta.bg }]} accessibilityRole="summary">
            <Ionicons name={meta.icon} size={32} color={meta.color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: meta.color }]}>{meta.title}</Text>
              <Text style={styles.body}>{meta.body}</Text>
            </View>
          </View>

          <Card>
            <Text style={styles.h2}>What happens next</Text>
            {steps.map((s, i) => (
              <View key={s.label} style={styles.step} accessible accessibilityLabel={`${s.label}${s.done ? ", done" : ""}`}>
                <View style={[styles.stepDot, s.done && styles.stepDone]}>
                  <Text style={[styles.stepNum, s.done && { color: "#fff" }]}>{s.done ? "✓" : i + 1}</Text>
                </View>
                <Text style={[styles.body, s.done && { color: Colors.textPrimary, fontFamily: Typography.fontFamily.semiBold }]}>{s.label}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.h2}>Services on your account</Text>
            {services && services.length > 0 ? (
              <View style={styles.wrap}>
                {services.map((s) => (
                  <View key={s.service_id} style={styles.tag}><Text style={styles.tagText}>{s.name}</Text></View>
                ))}
              </View>
            ) : (
              <Text style={styles.body}>No services are linked to your account yet.</Text>
            )}
            <Text style={styles.note}>Services that need equipment, like towing, are enabled once the Sahayak team has verified it.</Text>
            <View style={{ marginTop: Spacing.md }}>
              <Button label="Edit services" variant="outline" onPress={() => navigation.navigate("PartnerServices")} />
            </View>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  pad: { padding: Spacing.screenHorizontal, paddingBottom: 48 },
  status: { flexDirection: "row", gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg },
  statusTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold },
  body: { flexShrink: 1, fontSize: 15, color: Colors.textSecondary, lineHeight: 21, marginTop: 2 },
  h2: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, marginBottom: Spacing.md },
  step: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: 40 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.borderLight, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: Colors.brand700 },
  stepNum: { fontSize: 13, fontFamily: Typography.fontFamily.bold, color: Colors.textMuted },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  tagText: { fontSize: 14, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  note: { fontSize: 13, color: Colors.textSecondary, marginTop: 12 },
});
