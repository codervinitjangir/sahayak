// An owner adds a partner profile to the same login (ADR-034): register, link
// it to this login, set services, then switch into partner mode. The Sahayak
// team still verifies the partner before any job is offered.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Colors, Spacing } from "../../constants/theme";
import ScreenHero from "../../components/ui/ScreenHero";
import Button from "../../components/ui/Button";
import { Chip } from "../../components/ui/kit";
import { showDialog } from "../../components/ui/AppDialog";
import { useAuthStore } from "../../store/authStore";
import { partnerApi } from "../../services/api/partner";
import { servicesApi } from "../../services/api/services";

type Category = "towing" | "mechanical";
type CatalogItem = { id: number; code: string; name: string };

export default function BecomePartnerScreen() {
  const navigation = useNavigation();
  const user = useAuthStore((s) => s.user);
  const setActiveProfile = useAuthStore((s) => s.setActiveProfile);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const [name, setName] = useState(user?.name && user.name !== "Vehicle owner" ? user.name : "");
  const [category, setCategory] = useState<Category | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    servicesApi
      .listServices()
      .then((items) => setCatalog(items as CatalogItem[]))
      .catch(() => setError("Could not load services. Go back and try again."));
  }, []);

  const phone = user?.phone ? `+${user.phone.replace(/^\+/, "")}` : "";

  const submit = async () => {
    const clean = name.trim();
    if (clean.length < 2) return setError("Enter your name or business name.");
    if (!category) return setError("Choose your main work.");
    if (chosen.length === 0) return setError("Choose at least one service.");
    setBusy(true);
    setError(null);
    const prev = useAuthStore.getState().activeProfile;
    try {
      const created = await partnerApi.register(clean, phone, category);
      setActiveProfile("partner");
      await partnerApi.linkAuth(created.id);
      await partnerApi.setServices(created.id, chosen).catch(() => undefined);
      const ok = await switchProfile("partner");
      if (!ok) throw new Error("switch failed");
      showDialog("You are registered", "The Sahayak team will verify your details before you receive jobs.");
    } catch (e: any) {
      setActiveProfile(prev);
      setError(e?.response?.data?.error?.message ?? "We could not register you. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (code: string) =>
    setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));

  return (
    <View style={styles.root}>
      <ScreenHero
        title="Become a partner"
        left={{ icon: "chevron-back", onPress: () => navigation.goBack(), label: "Back" }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={styles.sub}>Same number, same login. You can switch back to owner mode any time.</Text>

          <Text style={styles.label}>Your name or business name</Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setError(null);
              setName(t);
            }}
            placeholder="e.g. Ravi Kumar"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            accessibilityLabel="Name or business name"
            style={styles.input}
          />

          <Text style={styles.label}>Main work</Text>
          <View style={styles.wrap}>
            <Chip label="Towing" selected={category === "towing"} onPress={() => setCategory("towing")} />
            <Chip
              label="Mechanic / on-site repair"
              selected={category === "mechanical"}
              onPress={() => setCategory("mechanical")}
            />
          </View>

          <Text style={styles.label}>Services you provide</Text>
          <View style={styles.wrap}>
            {catalog.map((s) => (
              <Chip key={s.id} label={s.name} selected={chosen.includes(s.code)} onPress={() => toggle(s.code)} />
            ))}
          </View>
          <Text style={styles.note}>Towing needs your equipment verified by Sahayak before you are offered those jobs.</Text>

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={{ marginTop: Spacing.lg }}>
            <Button label="Register as partner" onPress={submit} loading={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  pad: { padding: Spacing.screenHorizontal, paddingBottom: 48 },
  sub: { fontSize: 15, color: Colors.textSecondary, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: 8 },
  input: {
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 52,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  wrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  note: { fontSize: 13, color: Colors.textSecondary, marginTop: 10 },
  error: { color: Colors.error, fontSize: 15, marginTop: Spacing.md },
});
