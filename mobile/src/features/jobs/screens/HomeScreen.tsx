// ─── Sahayak: owner shell ─────────────────────────────────────────────────────
// Four tabs: Home, Services, Activity, Account. The request flow itself lives in
// OwnerHelpFlowScreen and is pushed on top of this shell.
import React, { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Colors } from "../../../constants/theme";
import LogoMark from "../../../components/brand/LogoMark";
import ScreenHero, { HeroPill } from "../../../components/ui/ScreenHero";
import { useAuthStore } from "../../../store/authStore";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { OwnerStackParamList } from "../../../types";
import TabBar, { TAB_BAR_SPACE, type TabDef } from "../../../components/ui/TabBar";
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
  const nav = useNavigation<NativeStackNavigationProp<OwnerStackParamList>>();

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

  const user = useAuthStore((st) => st.user);
  const first = (user?.name ?? "").split(" ")[0];
  const named = first && !/^(vehicle|service)$/i.test(first);
  const heroCopy: Record<TabKey, { title: string; greeting?: string; subtitle?: string }> = {
    home: { title: "Sahayak", greeting: named ? `Hello, ${first}` : "Hello there", subtitle: "Stuck on the road? Help is a few taps away." },
    services: { title: "Services", greeting: "What do you need?", subtitle: "Verified partners for every roadside problem" },
    activity: { title: "Activity", greeting: "Your requests", subtitle: "Follow live jobs and look back at past ones" },
    account: { title: "Account", greeting: named ? `Hello, ${first}` : "Your account", subtitle: "Profile, vehicles and help" },
  };
  const h = heroCopy[tab];
  const bell = { icon: "notifications-outline" as const, label: unread > 0 ? `Notifications, ${unread} unread` : "Notifications", onPress: () => setNotifOpen(true), dot: unread > 0 };

  return (
    <View style={styles.root}>
      <ScreenHero
        title={h.title}
        greeting={h.greeting}
        subtitle={h.subtitle}
        center={tab !== "home"}
        left={<LogoMark size={36} />}
        right={bell}
      >
        {tab === "home" ? (
          <HeroPill
            title="Request roadside help"
            subtitle="Where you are · What happened"
            actionIcon="arrow-forward"
            onPress={() => nav.navigate("OwnerFlow", { initialStep: "service_select" })}
          />
        ) : null}
      </ScreenHero>

      <View style={styles.body}>
        {tab === "home" && (
          <HomeTab onOpenActivity={() => setTab("activity")} onAddVehicle={() => setAddVehicleOpen(true)} />
        )}
        {tab === "services" && <ServicesTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "account" && <AccountTab onAddVehicle={() => setAddVehicleOpen(true)} />}
      </View>

      <View style={styles.barDock} pointerEvents="box-none">
        <ActiveRequestBar jobs={jobs.data} />
      </View>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      <AddVehicleModal visible={addVehicleOpen} onClose={() => setAddVehicleOpen(false)} />
      <NotificationsModal visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  body: { flex: 1, backgroundColor: Colors.surface, paddingBottom: TAB_BAR_SPACE - 24 },
  barDock: { position: "absolute", left: 0, right: 0, bottom: TAB_BAR_SPACE },
});
