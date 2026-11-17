// ─── Sahayak: owner shell ─────────────────────────────────────────────────────
// Four tabs: Home, Services, Activity, Account. The request flow itself lives in
// OwnerHelpFlowScreen and is pushed on top of this shell.
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "../../../services/api/users";
import GarageSheet from "../../home/GarageSheet";
import { Colors, Spacing, Typography } from "../../../constants/theme";
import { HeroCarousel, VehicleChip, VehicleCard } from "../../home/HomeHeroExtras";
import LogoMark from "../../../components/brand/LogoMark";
import ScreenHero, { HeroPill } from "../../../components/ui/ScreenHero";
import { HeroShell } from "../../../components/ui/CollapsingHero";
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
import { QK, useMyJobs, useMyVehicles, useUnreadCount } from "../../shared/ownerData";
import ActiveRequestBar from "../../home/ActiveRequestBar";
import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";

type TabKey = "home" | "services" | "activity" | "account";

export default function HomeScreen() {
  const [tab, setTab] = useState<TabKey>("home");
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [editSignal, setEditSignal] = useState(0);
  const unread = useUnreadCount().data ?? 0;
  const jobs = useMyJobs();
  const vehicles = useMyVehicles();
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
    { key: "services", label: "Services", icon: "construct-outline", iconActive: "construct" },
    { key: "activity", label: "Activity", icon: "receipt-outline", iconActive: "receipt" },
    { key: "account", label: "Profile", icon: "person-circle-outline", iconActive: "person-circle" },
  ];

  const user = useAuthStore((st) => st.user);
  // The auth store only has a placeholder after a restore; the profile has the real name.
  const me = useQuery({ queryKey: ["owner", "me"], queryFn: usersApi.getMe });
  const fullName = me.data?.name ?? user?.name ?? "";
  const first = fullName.split(" ")[0];
  const named = first && !/^(vehicle|service)$/i.test(first);
  const heroCopy: Record<TabKey, { title: string; greeting?: string; subtitle?: string }> = {
    home: { title: "Sahayak", greeting: named ? `Hello, ${first}` : "Hello there" },
    services: { title: "Services", greeting: "What do you need?", subtitle: "Verified partners for every roadside problem" },
    activity: { title: "Activity", greeting: "Your requests", subtitle: "Follow live jobs and look back at past ones" },
    account: { title: "Profile" },
  };
  const h = heroCopy[tab];
  const bell = { icon: "notifications-outline" as const, label: unread > 0 ? `Notifications, ${unread} unread` : "Notifications", onPress: () => setNotifOpen(true), dot: unread > 0 };

  const hero = (
  <ScreenHero
    title={h.title}
    greeting={h.greeting}
    subtitle={h.subtitle}
    center={tab !== "home"}
    left={<LogoMark size={36} />}
    right={bell}
  >
    {tab === "account" ? (
      <View style={styles.acct}>
        <View style={styles.acctTop}>
          <View style={styles.acctAvatar}><Text style={styles.acctAvatarText}>{(named ? first : "S").charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.acctName} numberOfLines={1}>{named ? fullName : "Sahayak user"}</Text>
            {(me.data?.phone ?? user?.phone) ? (
              <View style={styles.acctRow}>
                <Ionicons name="call" size={14} color="rgba(255,255,255,0.75)" />
                <Text style={styles.acctPhone}>{me.data?.phone ?? user?.phone}</Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => setEditSignal((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Edit profile" hitSlop={8} style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="create-outline" size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>
        <VehicleCard vehicle={vehicles.data?.[0]} count={vehicles.data?.length ?? 0} onPress={() => (vehicles.data?.length ? setGarageOpen(true) : setAddVehicleOpen(true))} />
      </View>
    ) : tab === "home" ? (
      <View style={{ gap: Spacing.base }}>
        <VehicleChip vehicle={vehicles.data?.[0]} onPress={() => (vehicles.data?.length ? setGarageOpen(true) : setAddVehicleOpen(true))} />
        <HeroCarousel
          slides={[
            { art: "map", kicker: "Roadside help", title: "Stranded? We find help near you", body: "Share your spot and a nearby verified partner is offered your job.", tags: ["Puncture", "Battery", "Towing"], onPress: () => nav.navigate("OwnerFlow", { initialStep: "service_select" }) },
            { art: "shield", kicker: "Safe by design", title: "Verified partners only", body: "Every partner is checked by the Sahayak team before they get a job." },
            { art: "partner", kicker: "Earn with Sahayak", title: "Mechanic or tow operator?", body: "Become a partner with this same number from your Account.", onPress: () => setTab("account") },
          ]}
        />
        <HeroPill
          title="Request roadside help"
          subtitle="Where you are · What happened"
          actionIcon="arrow-forward"
          onPress={() => nav.navigate("OwnerFlow", { initialStep: "service_select" })}
        />
      </View>
    ) : null}
  </ScreenHero>
  );

  return (
    <View style={styles.root}>
      <HeroShell hero={hero} left={<LogoMark size={28} />} right={bell} resetKey={tab}>

      <View style={styles.body}>
        {tab === "home" && (
          <HomeTab onOpenServices={() => setTab("services")} onOpenActivity={() => setTab("activity")} onAddVehicle={() => setAddVehicleOpen(true)} />
        )}
        {tab === "services" && <ServicesTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "account" && <AccountTab onAddVehicle={() => setAddVehicleOpen(true)} editSignal={editSignal} />}
      </View>

      <View style={styles.barDock} pointerEvents="box-none">
        <ActiveRequestBar jobs={jobs.data} />
      </View>
      </HeroShell>
      <TabBar tabs={tabs} active={tab} onChange={setTab} center={{ icon: "car-sport", label: "SOS", onPress: () => nav.navigate("OwnerFlow", { initialStep: "service_select" }) }} />

      <AddVehicleModal visible={addVehicleOpen} onClose={() => setAddVehicleOpen(false)} />
      <NotificationsModal visible={notifOpen} onClose={() => setNotifOpen(false)} />
      <GarageSheet visible={garageOpen} vehicles={vehicles.data ?? []} onClose={() => setGarageOpen(false)} onAdd={() => setAddVehicleOpen(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  body: { flex: 1, backgroundColor: Colors.surface, paddingBottom: TAB_BAR_SPACE - 24 },
  acct: { gap: Spacing.base, marginTop: Spacing.sm },
  acctTop: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  acctAvatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.3)" },
  acctAvatarText: { color: "#fff", fontSize: 30, fontFamily: Typography.fontFamily.bold },
  acctName: { color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold },
  acctRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  acctPhone: { color: "rgba(255,255,255,0.75)", fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium },
  editBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  barDock: { position: "absolute", left: 0, right: 0, bottom: TAB_BAR_SPACE },
});
