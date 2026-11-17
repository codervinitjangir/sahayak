import { ProfileSwitchRow } from "../../profile/ProfileSwitchCard";
import { HeroScrollView } from "../../../components/ui/CollapsingHero";
import React, { useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { View, Text, ScrollView, StyleSheet, Linking, Switch, Pressable, Share } from "react-native";
import { showDialog } from "../../../components/ui/AppDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius } from "../../../constants/theme";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL } from "../../../constants/support";
import { useAuthStore } from "../../../store/authStore";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { ListRow, SectionHeader, Skeleton } from "../../../components/ui/kit";
import { EMERGENCY_NUMBER } from "../../../components/ui/SafetyActions";
import { WEB_URL } from "../../../constants";
import { useMyVehicles } from "../../shared/ownerData";
import { vehiclesApi } from "../../../services/api/vehicles";
import { usersApi, type OwnerProfile } from "../../../services/api/users";
import EditProfileModal from "../EditProfileModal";
import EditVehicleModal from "../EditVehicleModal";
import BrandLogo from "../../../components/brand/BrandLogo";
import VehiclePhoto from "../../../components/illustrations/VehiclePhoto";
import type { MobileVehicle } from "../../../services/api/vehicles";

export default function AccountTab({ onAddVehicle, editSignal = 0 }: { onAddVehicle: () => void; editSignal?: number }) {
  const nav = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const vehicles = useMyVehicles();
  const qc = useQueryClient();
  // The real profile from the backend; the auth store only knows a placeholder
  // name after a session restore.
  const me = useQuery({ queryKey: ["owner", "me"], queryFn: usersApi.getMe });
  const [editOpen, setEditOpen] = useState(false);
  // The hero's "Edit profile" button bumps editSignal.
  useEffect(() => {
    if (editSignal > 0) setEditOpen(true);
  }, [editSignal]);
  const [exporting, setExporting] = useState(false);
  const displayName = me.data?.name ?? user?.name ?? "Vehicle Owner";

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await usersApi.exportMe();
      await Share.share({ title: "My Sahayak data", message: JSON.stringify(data, null, 2) });
    } catch {
      showDialog("Could not export", "Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  };

  const confirmDeleteAccount = () =>
    showDialog(
      "Delete your account?",
      "Your name, phone, email, vehicles and notifications are erased and you are signed out. Past jobs stay on record without your details. This cannot be undone.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            try {
              await usersApi.deleteMe();
              logout();
            } catch (err: any) {
              const code = err?.response?.data?.error?.code;
              showDialog(
                "Could not delete",
                code === "ACCOUNT_HAS_ACTIVE_JOB"
                  ? "Finish or cancel your active request first."
                  : "Check your connection and try again."
              );
            }
          },
        },
      ]
    );

  // Settings & preferences state
  const [vehiclesCollapsed, setVehiclesCollapsed] = useState(false);
  const [editing, setEditing] = useState<MobileVehicle | null>(null);

  const vehicleList = vehicles.data ?? [];

  const handleDeleteVehicle = (vehicleId: string, name: string) => {
    showDialog("Remove vehicle?", `Remove ${name} from your account?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await vehiclesApi.deleteVehicle(vehicleId);
            void vehicles.refetch();
          } catch (err: any) {
            showDialog(
              "Could not remove",
              err?.message || "Cannot delete a vehicle with an active roadside request."
            );
          }
        },
      },
    ]);
  };

  const confirmSignOut = () =>
    showDialog("Sign out?", "You will need to verify your number again to sign back in.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  return (
    <HeroScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* Shortcuts */}
      <View style={styles.shortRow}>
        {[
          { icon: "car-sport-outline", label: "Add vehicle", bg: "#DBEAFE", fg: "#1D4ED8", go: onAddVehicle },
          { icon: "share-social-outline", label: "Share Sahayak", bg: "#FEF3C7", fg: "#B45309", go: () => void Share.share({ message: "Stuck on the road? Sahayak finds a verified mechanic or tow truck near you." }) },
          { icon: "call-outline", label: "Help & support", bg: "#DCFCE7", fg: "#15803D", go: () => void Linking.openURL(SUPPORT_PHONE_TEL) },
        ].map((t) => (
          <Pressable key={t.label} onPress={t.go} accessibilityRole="button" accessibilityLabel={t.label} style={({ pressed }) => [styles.shortTile, pressed && { opacity: 0.85 }]}>
            <View style={[styles.shortIcon, { backgroundColor: t.bg }]}><Ionicons name={t.icon as any} size={24} color={t.fg} /></View>
            <Text style={styles.shortLabel} numberOfLines={2}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* My Vehicles Garage Table */}
      <View>
        <View style={styles.garageHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle} accessibilityRole="header">My garage</Text>
            <Text style={styles.garageSub}>
              {vehicleList.length === 0 ? "No vehicles saved" : `${vehicleList.length} ${vehicleList.length === 1 ? "vehicle" : "vehicles"} saved`}
            </Text>
          </View>
          <Pressable onPress={onAddVehicle} accessibilityRole="button" accessibilityLabel="Add a vehicle" style={({ pressed }) => [styles.garageAdd, pressed && { opacity: 0.85 }]}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.garageAddText}>Add</Text>
          </Pressable>
        </View>

        {!vehiclesCollapsed ? (
          <Card noPad>
            {vehicles.isLoading ? (
              <View style={{ padding: Spacing.base }}>
                <Skeleton height={24} />
              </View>
            ) : vehicles.isError ? (
              <ListRow icon="alert-circle-outline" title="Could not load vehicles" subtitle="Pull down on Home to retry" last />
            ) : vehicleList.length === 0 ? (
              <ListRow icon="add-circle-outline" title="Add your first vehicle" subtitle="Needed to request emergency assistance" onPress={onAddVehicle} last />
            ) : (
              vehicleList.map((v, i) => (
                <View
                  key={v.id}
                  style={[styles.vehicleRow, i < vehicleList.length - 1 && styles.rowDivider]}
                >
                  <View style={styles.garageThumb}>
                    <VehiclePhoto make={v.make} model={v.model} type={v.vehicle_type} />
                    <View style={{ position: "absolute", left: 3, bottom: 3 }}><BrandLogo make={v.make} size={22} round color={Colors.brand700} /></View>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.vehicleName}>
                      {v.make} {v.model}
                    </Text>
                    <View style={styles.plateBadge}>
                      <Text style={styles.plateText}>{v.vehicle_number}</Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => setEditing(v)}
                    style={styles.deleteVehicleBtn}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${v.make} ${v.model}`}
                  >
                    <Ionicons name="create-outline" size={19} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteVehicle(v.id, `${v.make} ${v.model}`)}
                    style={styles.deleteVehicleBtn}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${v.make} ${v.model}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </Card>
        ) : (
          <Card>
            <Pressable
              onPress={() => setVehiclesCollapsed(false)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
            >
              <Text style={styles.settingsLabel}>
                {vehicleList.length} vehicles configured
              </Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.brand700} />
            </Pressable>
          </Card>
        )}
      </View>

      {/* Safety & Emergency Settings */}
      <View>
        <SectionHeader title="Safety & Trip Sharing" />
        <Card noPad>
          <ListRow
            icon="call-outline"
            title={`Police & Medical Services (${EMERGENCY_NUMBER})`}
            subtitle="National Emergency Response System"
            onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
          />
          <ListRow
            icon="shield-outline"
            title="Sahayak 24/7 Roadside Control Room"
            subtitle={SUPPORT_PHONE_DISPLAY}
            onPress={() => void Linking.openURL(SUPPORT_PHONE_TEL)}
            last
          />
        </Card>
      </View>

      <Card noPad>
        <ListRow icon="create-outline" title="Edit profile" subtitle="Name and email" onPress={() => setEditOpen(true)} />
        <ProfileSwitchRow />
        <ListRow icon="settings-outline" title="Settings" subtitle="Become a partner, notifications, help, your data, sign out" onPress={() => nav.navigate("OwnerSettings")} last />
      </Card>
      <EditVehicleModal vehicle={editing} onClose={() => setEditing(null)} />
      <EditProfileModal
        visible={editOpen}
        profile={me.data ?? null}
        onClose={() => setEditOpen(false)}
        onSaved={(p) => qc.setQueryData(["owner", "me"], p as OwnerProfile)}
      />
    </HeroScrollView>
  );
}

const styles = StyleSheet.create({
  shortRow: { flexDirection: "row", gap: Spacing.sm },
  shortTile: { flex: 1, alignItems: "center", gap: 8, paddingVertical: Spacing.base, paddingHorizontal: 6, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  shortIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  shortLabel: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, textAlign: "center" },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: Spacing["4xl"] + 40 },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  profile: { flexDirection: "row", alignItems: "center", gap: Spacing.base },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold },
  name: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  phone: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
  membershipPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.brand700Light, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, alignSelf: "flex-start", marginTop: 2 },
  membershipText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700Dark },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.sm },
  sectionTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  garageThumb: { width: 76, height: 54, borderRadius: Radius.lg, overflow: "hidden", backgroundColor: Colors.surface },
  garageHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginBottom: Spacing.md },
  garageSub: { marginTop: 2, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  garageAdd: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: Colors.textPrimary },
  garageAddText: { color: "#fff", fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold },
  countBadge: { backgroundColor: Colors.brand700Light, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  countBadgeText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.bold, color: Colors.brand700Dark },
  collapseToggle: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  collapseToggleText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  addBtnText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold, color: Colors.brand700 },

  vehicleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.base, paddingVertical: Spacing.md, gap: Spacing.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderLight },
  vehicleIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.brand700Light, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  plateBadge: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm, alignSelf: "flex-start", marginTop: 2 },
  plateText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: 0.5 },
  deleteVehicleBtn: { padding: Spacing.xs },

  settingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.base, paddingVertical: Spacing.base, gap: Spacing.md },
  settingsLabel: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  settingsSub: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted, lineHeight: 17 },
});
