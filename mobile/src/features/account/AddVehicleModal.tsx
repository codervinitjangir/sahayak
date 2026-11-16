import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Radius, Spacing } from "../../constants/theme";
import Button from "../../components/ui/Button";
import { vehiclesApi, type MobileVehicle } from "../../services/api/vehicles";
import { QK } from "../shared/ownerData";

type VehicleType = "two_wheeler" | "four_wheeler";

const EMPTY = { make: "", model: "", vehicle_number: "" };

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
  const [form, setForm] = useState(EMPTY);
  const [type, setType] = useState<VehicleType>("four_wheeler");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setError(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const close = () => {
    setForm(EMPTY);
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!form.make.trim() || !form.model.trim() || !form.vehicle_number.trim()) {
      setError("Enter the make, model and registration number.");
      return;
    }
    setSaving(true);
    try {
      const created = await vehiclesApi.createVehicle({
        make: form.make.trim(),
        model: form.model.trim(),
        vehicle_number: form.vehicle_number.trim().toUpperCase(),
        vehicle_type: type,
      });
      await qc.invalidateQueries({ queryKey: QK.vehicles });
      onAdded?.(created);
      close();
    } catch (e: any) {
      const apiMsg = e?.response?.data?.error?.message;
      const code = e?.response?.data?.error?.code;
      setError(
        code === "VEHICLE_ALREADY_REGISTERED"
          ? "This registration number is already saved."
          : apiMsg ?? e?.message ?? "The vehicle could not be saved."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.scrim} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.scrimTap} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, Platform.OS === "android" && keyboardHeight > 0 && { marginBottom: keyboardHeight, maxHeight: "75%" }]}>
          <View style={styles.grabber} />
          <Text style={styles.title} accessibilityRole="header">
            Add a vehicle
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.typeRow}>
              {(["four_wheeler", "two_wheeler"] as const).map((t) => {
                const on = type === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setType(t)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.typeBtn, on && styles.typeBtnOn]}
                  >
                    <Ionicons
                      name={t === "four_wheeler" ? "car-outline" : "bicycle-outline"}
                      size={22}
                      color={on ? Colors.onPrimary : Colors.textSecondary}
                    />
                    <Text style={[styles.typeText, on && { color: Colors.onPrimary }]}>
                      {t === "four_wheeler" ? "Car" : "Two-wheeler"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Field label="Make" value={form.make} onChange={set("make")} placeholder="e.g. Hyundai" />
            <Field label="Model" value={form.model} onChange={set("model")} placeholder="e.g. i20" />
            <Field
              label="Registration number"
              value={form.vehicle_number}
              onChange={set("vehicle_number")}
              placeholder="KA01AB1234"
              autoCapitalize="characters"
            />

            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <View style={{ marginTop: Spacing.base, gap: Spacing.sm }}>
              <Button label="Save vehicle" onPress={save} loading={saving} />
              <Button label="Cancel" variant="ghost" onPress={close} disabled={saving} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.ComponentProps<typeof TextInput>, "value" | "onChangeText" | "onChange">) {
  return (
    <View style={{ marginTop: Spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={Colors.textMuted}
        accessibilityLabel={label}
        style={styles.input}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: Colors.overlay },
  scrimTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    maxHeight: "90%",
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: Spacing.md },
  title: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  typeRow: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.base },
  typeBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  typeBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  label: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    fontSize: Typography.fontSize.md,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textPrimary,
    backgroundColor: Colors.surfaceWhite,
  },
  error: { marginTop: Spacing.md, color: Colors.error, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium },
});
