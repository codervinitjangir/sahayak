// Choose which services this partner offers (POST /partners/{id}/services).
// Same capability as the web Preferences page, for partners who only use a phone.
import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Button from "../../../components/ui/Button";
import { Chip, ErrorState, Skeleton } from "../../../components/ui/kit";
import { showDialog } from "../../../components/ui/AppDialog";
import { useAuthStore } from "../../../store/authStore";
import { partnerApi, type MobilePartnerService } from "../../../services/api/partner";
import { Ionicons } from "@expo/vector-icons";
import { servicesApi } from "../../../services/api/services";

type CatalogItem = { id: number; code: string; name: string; requires_vehicle_equipment?: boolean };

export default function PartnerServicesScreen() {
  const navigation = useNavigation();
  const partnerId = useAuthStore((s) => s.user?.id);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [mine, setMine] = useState<MobilePartnerService[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setFailed(false);
    try {
      const [all, mine] = await Promise.all([servicesApi.listServices(), partnerApi.getServices()]);
      setCatalog(all as CatalogItem[]);
      setChosen((mine.services ?? []).map((s) => s.code));
      setMine(mine.services ?? []);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (code: string) =>
    setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));

  const save = async () => {
    if (!partnerId) return;
    if (chosen.length === 0) {
      showDialog("Choose at least one service", "You need at least one service to receive jobs.");
      return;
    }
    setBusy(true);
    try {
      await partnerApi.setServices(partnerId, chosen);
      navigation.goBack();
    } catch (e: any) {
      showDialog("Could not save", e?.response?.data?.error?.message ?? "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHero
        title="Services & capabilities"
        left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }}
      />
      {failed ? (
        <ErrorState message="Could not load services." onRetry={() => void load()} />
      ) : !catalog ? (
        <View style={styles.pad}>
          <Skeleton height={120} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.pad}>
          {mine.length > 0 ? (
            <View style={styles.capCard}>
              <Text style={styles.h2}>Your capabilities</Text>
              {mine.map((s, i) => (
                <View key={s.service_id} style={[styles.capRow, i < mine.length - 1 && styles.capDivider]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.capName}>{s.name}</Text>
                    {s.dispatchable === false ? (
                      <View style={[styles.pill, { backgroundColor: Colors.warningLight }]}>
                        <Ionicons name="alert-circle" size={13} color={Colors.warning} />
                        <Text style={[styles.pillText, { color: Colors.warning }]}>Needs a verified tow vehicle</Text>
                      </View>
                    ) : (
                      <View style={[styles.pill, { backgroundColor: Colors.successLight }]}>
                        <View style={styles.dot} />
                        <Text style={[styles.pillText, { color: Colors.success }]}>Receiving jobs</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.price}>{s.base_price != null ? `From ₹${s.base_price}` : "Standard"}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[styles.h2, { marginTop: Spacing.lg }]}>Add or remove services</Text>
          <Text style={styles.sub}>Tap to add or remove. You only get offers for services you choose.</Text>
          <View style={styles.wrap}>
            {catalog.map((s) => (
              <Chip key={s.id} label={s.name} selected={chosen.includes(s.code)} onPress={() => toggle(s.code)} />
            ))}
          </View>
          <Text style={styles.note}>Towing needs your equipment verified by Sahayak before you are offered those jobs.</Text>
          <View style={{ marginTop: Spacing.lg }}>
            <Button label="Save services" onPress={save} loading={busy} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  pad: { padding: Spacing.screenHorizontal, paddingBottom: 48 },
  sub: { fontSize: 15, color: Colors.textSecondary, lineHeight: 21, marginBottom: Spacing.md },
  wrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  h2: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary, marginBottom: 8 },
  capCard: { backgroundColor: Colors.surfaceWhite, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  capRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  capDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  capName: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: "600" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  price: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  note: { fontSize: 13, color: Colors.textSecondary, marginTop: 12 },
});
