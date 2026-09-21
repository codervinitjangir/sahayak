// ─── Sahayak — Service Select Screen ─────────────────────────────────────────
// Figma: owner-service-select — sub-service chips, notes, photo, estimate panel
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows, ServiceConfig } from "../../../constants/theme";
import { MOCK_SUB_SERVICES, MOCK_VEHICLES } from "../../../services/api";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { useJobStore } from "../../../store/jobStore";
import type { OwnerStackParamList, ServiceType } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "ServiceSelect">;
type Route = RouteProp<OwnerStackParamList, "ServiceSelect">;

const SERVICE_TYPES: ServiceType[] = ["battery", "tyre", "towing", "fuel", "lockout", "mechanic"];

export default function ServiceSelectScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { setDraftService, setDraftSubService, setDraftNotes } = useJobStore();

  const [selectedService, setSelectedService] = useState<ServiceType>("battery");
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const vehicle = MOCK_VEHICLES.find((v) => v.id === route.params?.vehicleId) ?? MOCK_VEHICLES[0];
  const subServices = MOCK_SUB_SERVICES[selectedService] ?? [];
  const selectedSub = subServices.find((s) => s.id === selectedSubId);

  const serviceCfg = ServiceConfig[selectedService];

  const handleContinue = () => {
    if (!selectedSubId) {
      Alert.alert("Select Service", "Please choose a specific service option.");
      return;
    }
    setDraftService(selectedService, vehicle.id);
    setDraftSubService(selectedSubId);
    setDraftNotes(notes);
    nav.navigate("PickupLocation", {
      serviceType: selectedService,
      vehicleId: vehicle.id,
      subServiceId: selectedSubId,
      notes,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* ── Header (Figma: header row) ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Vehicle Summary (Figma: section-vehicle) ── */}
        <Card style={styles.vehicleCard} noPad>
          <View style={styles.vehicleRow}>
            <View style={[styles.vehicleIcon, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons
                name={vehicle.type === "two-wheeler" ? "bicycle" : "car-sport"}
                size={22}
                color={Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleName}>{vehicle.make} {vehicle.model}</Text>
              <Text style={styles.vehiclePlate}>{vehicle.licensePlate}</Text>
            </View>
            <TouchableOpacity>
              <Text style={styles.changeText}>Change</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* ── Service Type Chips ── */}
        <Text style={styles.sectionLabel}>What do you need?</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {SERVICE_TYPES.map((svc) => {
            const cfg = ServiceConfig[svc];
            const selected = svc === selectedService;
            return (
              <TouchableOpacity
                key={svc}
                style={[
                  styles.chip,
                  selected && { backgroundColor: cfg.bg, borderColor: cfg.color },
                ]}
                onPress={() => {
                  setSelectedService(svc);
                  setSelectedSubId(null);
                }}
              >
                <Ionicons
                  name={cfg.icon as any}
                  size={16}
                  color={selected ? cfg.color : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.chipText,
                    selected && { color: cfg.color, fontFamily: Typography.fontFamily.semiBold },
                  ]}
                >
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Sub-Service Options (Figma: section-subservice) ── */}
        <Text style={styles.sectionLabel}>Choose specific help</Text>
        <View style={styles.subServices}>
          {subServices.map((sub) => {
            const selected = sub.id === selectedSubId;
            return (
              <TouchableOpacity
                key={sub.id}
                style={[styles.subCard, selected && styles.subCardSelected]}
                onPress={() => setSelectedSubId(sub.id)}
              >
                <View style={styles.subLeft}>
                  <View
                    style={[
                      styles.subRadio,
                      selected && { borderColor: Colors.primary, backgroundColor: Colors.primary },
                    ]}
                  >
                    {selected && <View style={styles.subRadioDot} />}
                  </View>
                  <View>
                    <Text style={[styles.subName, selected && { color: Colors.primary }]}>
                      {sub.name}
                    </Text>
                    {sub.description && (
                      <Text style={styles.subDesc}>{sub.description}</Text>
                    )}
                  </View>
                </View>
                {sub.estimatedPrice && (
                  <Text style={[styles.subPrice, selected && { color: Colors.primary }]}>
                    ~₹{sub.estimatedPrice}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Notes (Figma: section-notes) ── */}
        <Text style={styles.sectionLabel}>Additional Notes</Text>
        <Card noPad style={{ marginBottom: Spacing.base }}>
          <TextInput
            style={styles.notesInput}
            placeholder="Describe the issue in detail… (optional)"
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
          />
        </Card>

        {/* ── Photo Tip (Figma: section-photo) ── */}
        <Card bg={Colors.infoLight} style={styles.photoTip} noPad>
          <View style={styles.photoTipRow}>
            <Ionicons name="camera-outline" size={20} color={Colors.info} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.photoTipTitle}>Add a photo (optional)</Text>
              <Text style={styles.photoTipSub}>Helps the partner arrive better prepared</Text>
            </View>
            <TouchableOpacity style={styles.photoBtn}>
              <Text style={styles.photoBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Bottom Panel (Figma: bottom-panel) ── */}
      <View style={[styles.bottomPanel, Shadows.sheet as ViewStyle]}>
        {selectedSub?.estimatedPrice && (
          <View style={styles.estimateRow}>
            <Text style={styles.estimateLabel}>Estimated Cost</Text>
            <Text style={styles.estimateAmount}>₹{selectedSub.estimatedPrice}</Text>
          </View>
        )}
        <Button
          label="Set Pickup Location"
          onPress={handleContinue}
          variant="primary"
          icon={<Ionicons name="location-outline" size={18} color={Colors.textWhite} />}
          iconPosition="right"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceWhite,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },

  vehicleCard: { marginBottom: Spacing.lg },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: Spacing.base,
  },
  vehicleIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehiclePlate: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  changeText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },

  sectionLabel: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },

  chipsScroll: {
    paddingBottom: Spacing.base,
    gap: 8,
    flexDirection: "row",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
  },
  chipText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
  },

  subServices: { gap: 8, marginBottom: Spacing.lg },
  subCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radius.md,
    padding: Spacing.base,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  subCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  subLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  subRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  subRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textWhite,
  },
  subName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  subDesc: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  subPrice: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textSecondary,
  },

  notesInput: {
    fontSize: Typography.fontSize.base,
    color: Colors.textPrimary,
    fontFamily: Typography.fontFamily.regular,
    padding: Spacing.base,
    minHeight: 80,
    textAlignVertical: "top",
  },

  photoTip: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.info,
  },
  photoTipRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.base,
  },
  photoTipTitle: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.info,
    marginBottom: 2,
  },
  photoTipSub: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  photoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.info,
  },
  photoBtnText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.info,
    fontFamily: Typography.fontFamily.semiBold,
  },

  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: Spacing.lg,
    gap: 12,
  },
  estimateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  estimateLabel: {
    fontSize: Typography.fontSize.base,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  estimateAmount: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
});

