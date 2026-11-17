// Edit a saved vehicle (PATCH /vehicles/{id}): make, model and number plate.
import React, { useEffect, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Radius, Spacing, Typography } from "../../constants/theme";
import Button from "../../components/ui/Button";
import BrandLogo from "../../components/brand/BrandLogo";
import { vehiclesApi, type MobileVehicle } from "../../services/api/vehicles";
import { QK } from "../shared/ownerData";

export default function EditVehicleModal({ vehicle, onClose }: { vehicle: MobileVehicle | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (vehicle) {
      setMake(vehicle.make);
      setModel(vehicle.model);
      setPlate(vehicle.vehicle_number);
      setErr(null);
    }
  }, [vehicle]);

  const save = async () => {
    if (!vehicle) return;
    const payload: Record<string, string> = {};
    if (make.trim() && make.trim() !== vehicle.make) payload.make = make.trim();
    if (model.trim() && model.trim() !== vehicle.model) payload.model = model.trim();
    const p = plate.trim().toUpperCase();
    if (p && p !== vehicle.vehicle_number) payload.vehicle_number = p;
    if (Object.keys(payload).length === 0) return onClose();
    setBusy(true);
    setErr(null);
    try {
      await vehiclesApi.updateVehicle(vehicle.id, payload);
      await qc.invalidateQueries({ queryKey: QK.vehicles });
      onClose();
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      setErr(code === "DUPLICATE_VEHICLE" || e?.response?.status === 409 ? "That number plate is already saved." : "Could not save. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={Boolean(vehicle)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <BrandLogo make={make} size={48} />
            <Text style={styles.title}>Edit vehicle</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </Pressable>
          </View>
          <Field label="Brand" value={make} onChange={setMake} />
          <Field label="Model" value={model} onChange={setModel} />
          <Field label="Number plate" value={plate} onChange={(t) => setPlate(t.toUpperCase())} caps />
          {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
          <Button label="Save changes" onPress={() => void save()} loading={busy} fullWidth />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, caps }: { label: string; value: string; onChange: (t: string) => void; caps?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize={caps ? "characters" : "words"}
        maxLength={caps ? 32 : 50}
        style={[styles.input, caps && { letterSpacing: 2, fontFamily: Typography.fontFamily.bold }]}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: Colors.overlay },
  sheet: { backgroundColor: Colors.surfaceWhite, borderTopLeftRadius: Radius["2xl"], borderTopRightRadius: Radius["2xl"], paddingHorizontal: Spacing.screenHorizontal, paddingTop: Spacing.sm, gap: Spacing.base },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  title: { flex: 1, fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  label: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary },
  input: { minHeight: 52, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.base, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary },
  err: { color: Colors.emergency, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium },
});
