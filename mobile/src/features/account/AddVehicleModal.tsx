// Add a vehicle in four short steps: bike or car → brand → model → number.
// Brands and models are suggestions; "Other" lets the owner type anything.
import React, { useMemo, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Radius, Spacing, Hero } from "../../constants/theme";
import Button from "../../components/ui/Button";
import ServiceArt from "../../components/illustrations/ServiceArt";
import { vehiclesApi, type MobileVehicle } from "../../services/api/vehicles";
import { QK } from "../shared/ownerData";
import { BRANDS, type VehicleKind } from "./vehicleCatalog";

type Step = "type" | "brand" | "model" | "plate";
const TITLES: Record<Step, string> = { type: "Add a vehicle", brand: "Select brand", model: "Select model", plate: "Add to my garage" };

export default function AddVehicleModal({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded?: (v: MobileVehicle) => void;
}) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("type");
  const [kind, setKind] = useState<VehicleKind>("four_wheeler");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setStep("type");
    setMake("");
    setModel("");
    setPlate("");
    setQuery("");
    setCustom(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const go = (s: Step) => {
    setQuery("");
    setCustom(false);
    setError(null);
    setStep(s);
  };
  const back = () => {
    if (step === "type") return close();
    go(step === "plate" ? "model" : step === "model" ? "brand" : "type");
  };

  const brand = BRANDS[kind].find((b) => b.name === make);
  const q = query.trim().toLowerCase();
  const brands = useMemo(() => BRANDS[kind].filter((b) => b.name.toLowerCase().includes(q)), [kind, q]);
  const models = useMemo(() => (brand?.models ?? []).filter((m) => m.toLowerCase().includes(q)), [brand, q]);

  const save = async () => {
    const number = plate.replace(/\s+/g, "").toUpperCase();
    if (number.length < 4) return setError("Enter the registration number, e.g. KA01AB1234.");
    setSaving(true);
    try {
      const created = await vehiclesApi.createVehicle({ make: make.trim(), model: model.trim(), vehicle_number: number, vehicle_type: kind });
      await qc.invalidateQueries({ queryKey: QK.vehicles });
      onAdded?.(created);
      close();
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      setError(code === "VEHICLE_ALREADY_REGISTERED" ? "This registration number is already saved." : e?.response?.data?.error?.message ?? "The vehicle could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const search = (placeholder: string) => (
    <View style={styles.search}>
      <Ionicons name="search" size={20} color={Colors.textMuted} />
      <TextInput value={query} onChangeText={setQuery} placeholder={placeholder} placeholderTextColor={Colors.textMuted} style={styles.searchInput} accessibilityLabel={placeholder} />
    </View>
  );

  const customEntry = (label: string, value: string, setValue: (v: string) => void, next: () => void) => (
    <View style={{ gap: Spacing.md }}>
      <TextInput value={value} onChangeText={setValue} autoFocus placeholder={label} placeholderTextColor={Colors.textMuted} style={styles.input} accessibilityLabel={label} autoCapitalize="words" />
      <Button label="Continue" onPress={() => (value.trim().length >= 1 ? next() : setError(`Enter the ${label.toLowerCase()}.`))} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={back}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.backBtn}>
            <Ionicons name={step === "type" ? "close" : "arrow-back"} size={24} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.topTitle} accessibilityRole="header">{TITLES[step]}</Text>
          {step === "brand" || step === "model" ? (
            <Pressable onPress={() => setCustom(true)} accessibilityRole="button" style={styles.cantFind}>
              <Ionicons name="help-circle-outline" size={16} color="#065F46" />
              <Text style={styles.cantFindText}>Not listed?</Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === "type" && (
            <>
              <Text style={styles.h1}>Choose your <Text style={{ color: "#16A34A" }}>vehicle</Text> type</Text>
              <Text style={styles.sub}>You can add more vehicles any time.</Text>
              {(["two_wheeler", "four_wheeler"] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => {
                    setKind(k);
                    setMake("");
                    go("brand");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={k === "two_wheeler" ? "I have a bike or scooter" : "I have a car"}
                  style={({ pressed }) => [styles.typeCard, pressed && { transform: [{ scale: 0.98 }] }]}
                >
                  <View style={[styles.typeArt, { backgroundColor: k === "two_wheeler" ? "#FEF2F2" : "#EFF6FF" }]}>
                    <ServiceArt name={k === "two_wheeler" ? "bike" : "car"} width={150} />
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.typeSmall}>I have a</Text>
                    <Text style={styles.typeBig}>{k === "two_wheeler" ? "BIKE" : "CAR"}</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {step === "brand" &&
            (custom ? (
              customEntry("Brand", make, setMake, () => {
                setModel("");
                setStep("model");
                setCustom(true);
              })
            ) : (
              <>
                {search("Search brands…")}
                <Text style={styles.section}>All brands</Text>
                <View style={styles.grid}>
                  {brands.map((b) => (
                    <Pressable
                      key={b.name}
                      onPress={() => {
                        setMake(b.name);
                        setModel("");
                        go("model");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={b.name}
                      style={({ pressed }) => [styles.brandTile, pressed && { opacity: 0.8 }]}
                    >
                      <View style={[styles.brandMark, { backgroundColor: b.color }]}>
                        <Text style={styles.brandInitial}>{b.name.charAt(0)}</Text>
                      </View>
                      <Text style={[styles.brandName, { color: b.color }]} numberOfLines={2}>{b.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ))}

          {step === "model" &&
            (custom || !brand ? (
              customEntry("Model", model, setModel, () => go("plate"))
            ) : (
              <>
                {search(`Search ${make} models`)}
                <Text style={styles.section}>{make} models</Text>
                <View style={styles.grid}>
                  {models.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        setModel(m);
                        go("plate");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${make} ${m}`}
                      style={({ pressed }) => [styles.modelTile, pressed && { opacity: 0.8 }]}
                    >
                      <View style={[styles.modelArt, { backgroundColor: kind === "two_wheeler" ? "#FEF2F2" : "#EFF6FF" }]}>
                        <ServiceArt name={kind === "two_wheeler" ? "bike" : "car"} width={84} />
                      </View>
                      <Text style={styles.modelName} numberOfLines={2}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ))}

          {step === "plate" && (
            <>
              <View style={styles.selected}>
                <View style={[styles.modelArt, { width: 96, backgroundColor: kind === "two_wheeler" ? "#FEF2F2" : "#EFF6FF" }]}>
                  <ServiceArt name={kind === "two_wheeler" ? "bike" : "car"} width={84} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.selChip}>
                    <Ionicons name="checkmark-circle" size={14} color="#15803D" />
                    <Text style={styles.selChipText}>Selected</Text>
                  </View>
                  <Text style={styles.selName}>{make} {model}</Text>
                </View>
              </View>
              <Text style={styles.section}>Registration number</Text>
              <View style={styles.plateWrap}>
                <View style={styles.plateIn}><Text style={styles.plateInText}>IND</Text></View>
                <TextInput
                  value={plate}
                  onChangeText={(t) => {
                    setError(null);
                    setPlate(t.toUpperCase());
                  }}
                  placeholder="KA 01 AB 1234"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                  autoFocus
                  style={styles.plateInput}
                  accessibilityLabel="Registration number"
                />
              </View>
              <Text style={styles.sub}>Partners use it to find your vehicle on the road.</Text>
            </>
          )}

          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        </ScrollView>

        {step === "plate" ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
            <Button label="Add to my garage" onPress={save} loading={saving} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  top: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.screenHorizontal, paddingBottom: Spacing.md, backgroundColor: Colors.surfaceWhite },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  cantFind: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, minHeight: 36, borderRadius: 999, backgroundColor: "#D1FAE5" },
  cantFindText: { color: "#065F46", fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold },
  body: { padding: Spacing.screenHorizontal, gap: Spacing.base, paddingBottom: 48 },
  h1: { fontSize: 34, lineHeight: 40, fontFamily: Typography.fontFamily.bold, color: Hero.bg, marginTop: Spacing.sm },
  sub: { fontSize: 15, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 21 },
  typeCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  typeArt: { width: 170, height: 120, borderRadius: Radius.lg, alignItems: "center", justifyContent: "center" },
  typeSmall: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  typeBig: { fontSize: 32, fontFamily: Typography.fontFamily.bold, color: "#16A34A" },
  search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: Spacing.base, minHeight: 52, borderRadius: Radius.lg, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, fontSize: 16, color: Colors.textPrimary, fontFamily: Typography.fontFamily.regular },
  section: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Hero.bg, marginTop: Spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  brandTile: { width: "30%", flexGrow: 1, maxWidth: "32%", aspectRatio: 1, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center", gap: 8, padding: 8 },
  brandMark: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  brandInitial: { color: "#fff", fontSize: 24, fontFamily: Typography.fontFamily.bold },
  brandName: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.4 },
  modelTile: { width: "46%", flexGrow: 1, maxWidth: "48.5%", padding: Spacing.sm, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, alignItems: "center", gap: 8 },
  modelArt: { width: "100%", height: 76, borderRadius: Radius.lg, alignItems: "center", justifyContent: "center" },
  modelName: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, textAlign: "center", paddingBottom: 4 },
  input: { minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.base, fontSize: 16, backgroundColor: Colors.surfaceWhite, color: Colors.textPrimary },
  selected: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  selChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  selChipText: { color: "#15803D", fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold },
  selName: { marginTop: 6, fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  plateWrap: { flexDirection: "row", alignItems: "stretch", borderWidth: 2, borderColor: Colors.textPrimary, borderRadius: Radius.md, overflow: "hidden", backgroundColor: "#FEFCE8", minHeight: 60 },
  plateIn: { width: 48, backgroundColor: "#1D4ED8", alignItems: "center", justifyContent: "center" },
  plateInText: { color: "#fff", fontSize: 12, fontFamily: Typography.fontFamily.bold },
  plateInput: { flex: 1, fontSize: 24, letterSpacing: 3, textAlign: "center", fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  footer: { paddingHorizontal: Spacing.screenHorizontal, paddingTop: Spacing.md, backgroundColor: Colors.surfaceWhite, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  error: { color: Colors.error, fontSize: 15, fontFamily: Typography.fontFamily.medium },
});
