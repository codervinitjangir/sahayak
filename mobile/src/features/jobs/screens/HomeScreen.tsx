// ─── Sahayak: owner shell ─────────────────────────────────────────────────────
// Four tabs: Home, Services, Activity, Account. The request flow itself lives in
// OwnerHelpFlowScreen and is pushed on top of this shell.
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "../../../constants/theme";
import LogoMark from "../../../components/brand/LogoMark";
import TabBar, { type TabDef } from "../../../components/ui/TabBar";
import HomeTab from "../../home/HomeTab";
import ServicesTab from "../../services/screens/ServicesTab";
import ActivityTab from "../../activity/screens/ActivityTab";
import AccountTab from "../../account/screens/AccountTab";
import AddVehicleModal from "../../account/AddVehicleModal";
import NotificationsModal from "../../shared/NotificationsModal";
import { QK, useMyJobs, useUnreadCount } from "../../shared/ownerData";
import ActiveRequestBar from "../../home/ActiveRequestBar";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";

type TabKey = "home" | "services" | "activity" | "account";

export default function HomeScreen() {
  const [tab, setTab] = useState<TabKey>("home");
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = useUnreadCount().data ?? 0;
  const jobs = useMyJobs();
  const qc = useQueryClient();

  // React Query cannot see screen focus on native. Coming back from the
  // request flow must re-read the job list, or the shell keeps showing the
  // list from before the request existed.
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: QK.jobs });
    }, [qc])
  );

  const tabs: TabDef<TabKey>[] = [
    { key: "home", label: "Home", icon: "home-outline", iconActive: "home" },
    { key: "services", label: "Services", icon: "grid-outline", iconActive: "grid" },
    { key: "activity", label: "Activity", icon: "time-outline", iconActive: "time" },
    { key: "account", label: "Account", icon: "person-outline", iconActive: "person" },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={styles.brand}>
          <LogoMark size={32} />
          <Text style={styles.brandText}>Sahayak</Text>
        </View>
        <Pressable
          onPress={() => setNotifOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          style={styles.bell}
        >
          <Ionicons name="notifications-outline" size={26} color={Colors.textPrimary} />
          {unread > 0 ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>

      <View style={styles.body}>
        {tab === "home" && (
          <HomeTab onOpenActivity={() => setTab("activity")} onAddVehicle={() => setAddVehicleOpen(true)} />
        )}
        {tab === "services" && <ServicesTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "account" && <AccountTab onAddVehicle={() => setAddVehicleOpen(true)} />}
      </View>

      <View style={styles.barDock}>
        <ActiveRequestBar jobs={jobs.data} />
      </View>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      <AddVehicleModal visible={addVehicleOpen} onClose={() => setAddVehicleOpen(false)} />
      <NotificationsModal visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surfaceWhite },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenHorizontal,
    minHeight: 56,
    backgroundColor: Colors.surfaceWhite,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandText: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.section },
  bell: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginRight: -8 },
  bellDot: { position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.emergency, borderWidth: 2, borderColor: Colors.surfaceWhite },
  body: { flex: 1, backgroundColor: Colors.surface },
  barDock: { backgroundColor: Colors.surface },
});
