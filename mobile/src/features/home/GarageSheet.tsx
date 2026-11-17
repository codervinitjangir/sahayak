// Tapping the vehicle chip opens this: your saved vehicles and "Add vehicle".
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Typography, Radius, Spacing } from "../../constants/theme";
import ServiceArt from "../../components/illustrations/ServiceArt";
import type { MobileVehicle } from "../../services/api/vehicles";

export default function GarageSheet({
  visible,
  vehicles,
  onClose,
  onAdd,
}: {
  visible: boolean;
  vehicles: MobileVehicle[];
  onClose: () => void;
  onAdd: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grabber} />
        <Text style={styles.title} accessibilityRole="header">My garage</Text>
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: Spacing.md }}>
          {vehicles.map((v) => (
            <View key={v.id} style={styles.row}>
              <View style={[styles.art, { backgroundColor: v.vehicle_type === "two_wheeler" ? "#FEF2F2" : "#EFF6FF" }]}>
                <ServiceArt name={v.vehicle_type === "two_wheeler" ? "bike" : "car"} fill />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{v.make} {v.model}</Text>
                <View style={styles.plate}><Text style={styles.plateText}>{v.vehicle_number}</Text></View>
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => {
            onClose();
            onAdd();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="add-circle" size={22} color="#fff" />
          <Text style={styles.addText}>Add a vehicle</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: Colors.overlay },
  sheet: { backgroundColor: Colors.surfaceWhite, borderTopLeftRadius: Radius["2xl"], borderTopRightRadius: Radius["2xl"], paddingHorizontal: Spacing.screenHorizontal, paddingTop: Spacing.sm, gap: Spacing.base },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  title: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border },
  art: { width: 84, height: 60, borderRadius: Radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  name: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  plate: { alignSelf: "flex-start", marginTop: 6, borderWidth: 1.5, borderColor: Colors.textPrimary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "#FEFCE8" },
  plateText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, letterSpacing: 1, color: Colors.textPrimary },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: 999, backgroundColor: Colors.primary },
  addText: { color: "#fff", fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.bold },
});
