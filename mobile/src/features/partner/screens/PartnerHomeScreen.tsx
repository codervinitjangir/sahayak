// ─── Sahayak: partner shell ───────────────────────────────────────────────────
// Home (shift, offers, active job), Earnings, Account. Every figure on screen
// comes from the backend; a failed read shows an error, never a zero.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, Switch, StyleSheet, StatusBar, RefreshControl, Linking, AppState } from "react-native";
import { NAV_APP_LABEL, getNavApp, setNavApp as saveNavApp, type NavApp } from "../../../services/navigationPreference";
import { showDialog } from "../../../components/ui/AppDialog";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Location from "expo-location";

import { Colors, Typography, Spacing, Radius } from "../../../constants/theme";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL } from "../../../constants/support";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import LogoMark from "../../../components/brand/LogoMark";
import ScreenHero from "../../../components/ui/ScreenHero";
import TabBar, { TAB_BAR_SPACE, type TabDef } from "../../../components/ui/TabBar";
import { EmptyState, ErrorState, ListRow, SectionHeader, Skeleton, StatusChip } from "../../../components/ui/kit";
import { useAuthStore } from "../../../store/authStore";
import { useJobStore } from "../../../store/jobStore";
import { jobsApi } from "../../../services/api/jobs";
import type { BackendJob, BackendPartnerOfferItem } from "../../../services/api/jobs";
import {
  partnerApi,
  type MobilePartnerEarnings,
  type MobilePartnerService,
  type MobilePartnerTrustStats,
} from "../../../services/api/partner";
import type { PartnerStackParamList } from "../../../types";
import { inr, metresToKm } from "../partnerFormat";
import { OFFER_URGENT_S, formatCountdown, offerDeadlineMs, useSecondsLeft } from "../offerCountdown";
import { WEB_URL } from "../../../constants";
import NotificationsModal from "../../shared/NotificationsModal";
import EditProfileModal from "../../account/EditProfileModal";
import { useUnreadCount } from "../../shared/ownerData";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "PartnerHome">;
type TabKey = "home" | "earnings" | "account";

const TABS: TabDef<TabKey>[] = [
  { key: "home", label: "Home", icon: "home-outline", iconActive: "home" },
  { key: "earnings", label: "Earnings", icon: "wallet-outline", iconActive: "wallet" },
  { key: "account", label: "Account", icon: "person-outline", iconActive: "person" },
];

/** "0:42 left" on an offer card (ADR-032). Owns its own 1 s tick so the list does not re-render. */
function OfferTimer({ offer }: { offer: { offered_at: string; expires_at?: string | null } }) {
  const left = useSecondsLeft(offerDeadlineMs(offer));
  if (left === null) return null;
  return (
    <Text style={[styles.offerAge, left <= OFFER_URGENT_S && { color: Colors.warning }]}>
      {left === 0 ? "Time is up" : `${formatCountdown(left)} left`}
    </Text>
  );
}

export default function PartnerHomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isOnline, setOnline } = useJobStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);
  const token = useAuthStore((s) => s.token);
  const unread = useUnreadCount().data ?? 0;

  const [tab, setTab] = useState<TabKey>("home");
  const [offers, setOffers] = useState<BackendPartnerOfferItem[]>([]);
  const [offersError, setOffersError] = useState(false);
  const [knownLocation, setKnownLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dutyBusy, setDutyBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const [stats, setStats] = useState<MobilePartnerTrustStats | null>(null);
  const [earnings, setEarnings] = useState<MobilePartnerEarnings | null>(null);
  const [services, setServices] = useState<MobilePartnerService[]>([]);
  const [jobs, setJobs] = useState<BackendJob[]>([]);
  const [activeJob, setActiveJob] = useState<BackendJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);
  const [servicesCollapsed, setServicesCollapsed] = useState(false);
  const pausedServices = services.filter((s) => s.dispatchable === false);
  const [navApp, setNavApp] = useState<NavApp>("google");
  // While a duty change is in flight the server answer we are about to read
  // may predate it; do not let a stats refresh flip the switch back.
  const dutyBusyRef = useRef(false);

  useEffect(() => {
    void getNavApp().then(setNavApp);
  }, []);

  const chooseNavApp = (app: NavApp) => {
    setNavApp(app);
    void saveNavApp(app);
  };

  // Five independent reads: one failing degrades only its own card.
  const load = useCallback(async () => {
    const bad: string[] = [];
    const run = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        bad.push(name);
      }
    };
    await Promise.all([
      run("your stats", async () => {
        const s = await partnerApi.getStats();
        setStats(s);
        // The server owns duty state (dispatch reads partners.is_available).
        // Seeding from it is what keeps a reopened app from saying "Off duty"
        // while jobs are still being sent, and keeps offer polling running.
        if (typeof s.is_available === "boolean" && !dutyBusyRef.current) setOnline(s.is_available);
      }),
      run("earnings", async () => setEarnings(await partnerApi.getEarnings())),
      run("your services", async () => setServices((await partnerApi.getServices()).services ?? [])),
      run("job history", async () => setJobs((await jobsApi.fetchMyJobs(30, 0)).items ?? [])),
      run("your active job", async () => setActiveJob(await partnerApi.getActiveJob())),
    ]);
    setFailed(bad);
    setLoading(false);
  }, [setOnline]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back to the app (from Maps, a call, the launcher) re-reads the
  // server: duty may have changed on another device or from the admin panel.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => sub.remove();
  }, [load]);

  // While this screen is open, re-read duty state every 15 s: the same partner
  // may switch it from the browser, or ops from the admin panel.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const s = await partnerApi.getStats();
        if (typeof s.is_available === "boolean" && !dutyBusyRef.current) setOnline(s.is_available);
      } catch {
        // The next tick retries; a failed poll must not flip the switch.
      }
    }, 15000);
    return () => clearInterval(id);
  }, [setOnline]);

  const fetchOffers = useCallback(async () => {
    if (!isOnline) {
      setOffers([]);
      setOffersError(false);
      return;
    }
    try {
      setOffers(await jobsApi.getOffers());
      setOffersError(false);
    } catch {
      setOffersError(true);
    }
  }, [isOnline]);

  // The poll is the only source of offers: nothing local invents one.
  useEffect(() => {
    void fetchOffers();
    if (!isOnline) return;
    const id = setInterval(fetchOffers, 15000);
    return () => clearInterval(id);
  }, [isOnline, fetchOffers]);

  const acquireLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      showDialog("Location is off", "Sahayak needs your GPS position to match you with jobs nearby. Allow location access in settings and try again.");
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    setKnownLocation(coords);
    return coords;
  };

  // Going on duty is a backend state change, not a local switch. Dispatch reads
  // is_available AND the live location; publishing one without the other either
  // hides the partner or sends them jobs they cannot reach.
  const toggleDuty = async (val: boolean) => {
    if (dutyBusy) return;
    const partnerId = user?.id;
    if (!partnerId) {
      showDialog("Partner account required", "This device is not signed in as a partner, so your shift cannot be changed.");
      return;
    }
    setDutyBusy(true);
    dutyBusyRef.current = true;
    try {
      if (val) {
        const coords = knownLocation ?? (await acquireLocation());
        if (!coords) return;
        await partnerApi.reportLocation(partnerId, coords.latitude, coords.longitude);
      }
      await partnerApi.setAvailability(partnerId, val);
      setOnline(val);
      if (!val) setOffers([]);
      else void fetchOffers();
    } catch {
      showDialog(
        val ? "Could not go on duty" : "Could not go off duty",
        val
          ? "Sahayak could not register your availability. You are still off duty, so no jobs will be sent."
          : "Sahayak could not update your availability. You may still appear on duty to dispatch."
      );
    } finally {
      setDutyBusy(false);
      dutyBusyRef.current = false;
    }
  };

  const refreshLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const coords = await acquireLocation();
      if (!coords) return;
      if (user?.id) {
        try {
          await partnerApi.reportLocation(user.id, coords.latitude, coords.longitude);
        } catch {
          showDialog("Location not saved", "Your phone found a GPS fix, but Sahayak could not save it. Dispatch keeps using your last saved position.");
          return;
        }
      }
      showDialog("Location updated", isOnline ? "Dispatch has your current position." : "Position saved. Go on duty to start receiving jobs.");
    } catch {
      showDialog("GPS unavailable", "Could not get a GPS fix. Check that location services are on and try again.");
    } finally {
      setLocating(false);
    }
  };

  const confirmSignOut = () =>
    showDialog("Sign out?", isOnline ? "You are on duty. Signing out does not take you off duty; go off duty first." : "You will need to verify your number again to sign back in.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: logout },
    ]);

  const verification = stats?.verification_status;
  const verified = verification === "verified";

  return (
    <View style={styles.root}>
      <ScreenHero
        title={tab === "home" ? "Sahayak Partner" : tab === "earnings" ? "Earnings" : "Account"}
        greeting={user?.name && !/^service partner$/i.test(user.name) ? `Hello, ${user.name.split(" ")[0]}` : "Hello, partner"}
        subtitle={tab === "home" ? "Stay on duty to receive nearby jobs" : tab === "earnings" ? "What you have earned on Sahayak" : "Profile, settings and help"}
        left={<LogoMark size={36} />}
        right={{ icon: "notifications-outline", label: unread > 0 ? `Notifications, ${unread} unread` : "Notifications", onPress: () => setNotifOpen(true), dot: unread > 0 }}
      >
        <View style={styles.dutyPill} accessible accessibilityLabel={isOnline ? "On duty" : "Off duty"}>
          <View style={[styles.dutyDot, { backgroundColor: isOnline ? "#4ADE80" : Colors.offline }]} />
          <Text style={styles.dutyText}>{isOnline ? "On duty · receiving offers" : "Off duty"}</Text>
        </View>
      </ScreenHero>
      <NotificationsModal visible={notifOpen} onClose={() => setNotifOpen(false)} />
      <EditProfileModal
        visible={editNameOpen}
        mode="partner"
        profile={user ? { name: user.name } : null}
        onClose={() => setEditNameOpen(false)}
        onSaved={(p) => { if (user && token) setUser({ ...user, name: p.name }, token); }}
      />

      <View style={styles.body}>
        {tab === "home" && (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void load(); void fetchOffers(); }} tintColor={Colors.brand700} />}
          >
            {/* Shift card */}
            <Card>
              <View style={styles.shiftRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shiftTitle}>{isOnline ? "You are on duty" : "You are off duty"}</Text>
                  <Text style={styles.muted}>
                    {isOnline ? "Dispatch can send you jobs and sees your location." : "Go on duty to start receiving jobs near you."}
                  </Text>
                </View>
                <Switch
                  value={isOnline}
                  onValueChange={toggleDuty}
                  disabled={dutyBusy}
                  trackColor={{ false: Colors.border, true: Colors.brand700 }}
                  thumbColor="#fff"
                  accessibilityLabel="On duty"
                />
              </View>
              <Pressable onPress={refreshLocation} accessibilityRole="button" style={styles.locBtn}>
                <Ionicons name="locate-outline" size={18} color={Colors.brand700} />
                <Text style={styles.locText}>{locating ? "Finding location…" : knownLocation ? "Update my location" : "Share my location"}</Text>
              </Pressable>
              {!verified && verification ? (
                <View style={styles.verifyBanner} accessibilityRole="alert">
                  <Ionicons name="shield-outline" size={18} color={Colors.warning} />
                  <Text style={styles.verifyText}>
                    Your account is {verification.replace(/_/g, " ")}. You receive jobs only once the Sahayak team has verified you.
                  </Text>
                </View>
              ) : null}
              {verified && pausedServices.length > 0 ? (
                <Pressable
                  onPress={() => setTab("account")}
                  accessibilityRole="button"
                  accessibilityLabel="See why some services are not receiving jobs"
                  style={styles.verifyBanner}
                >
                  <Ionicons name="alert-circle-outline" size={18} color={Colors.warning} />
                  <Text style={styles.verifyText}>
                    {pausedServices.map((p) => p.name).join(" and ")}{" "}
                    jobs are not sent to you yet: they need a tow vehicle verified by Sahayak.
                  </Text>
                </Pressable>
              ) : null}
            </Card>

            {failed.length > 0 ? (
              <Pressable onPress={() => void load()} accessibilityRole="button" style={styles.errBanner}>
                <Ionicons name="cloud-offline-outline" size={18} color={Colors.error} />
                <Text style={styles.errText}>Could not load {failed.join(", ")}. Tap to retry.</Text>
              </Pressable>
            ) : null}

            {/* Active job */}
            {activeJob ? (
              <Pressable
                onPress={() => nav.navigate("ActiveJob", { jobId: activeJob.id })}
                accessibilityRole="button"
                accessibilityLabel="Open your active job"
                style={styles.activeCard}
              >
                <View style={styles.activeIcon}>
                  <Ionicons name="construct" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.activeKicker}>Active job</Text>
                  <Text style={styles.activeTitle} numberOfLines={1}>{activeJob.service_name ?? "Roadside job"}</Text>
                  <StatusChip status={activeJob.status} />
                </View>
                <Ionicons name="chevron-forward" size={22} color={Colors.brand700Dark} />
              </Pressable>
            ) : null}

            {/* Offers */}
            <View>
              <SectionHeader title="Job offers" />
              {!isOnline ? (
                <Card>
                  <EmptyState icon="power-outline" title="You are off duty" message="Go on duty to see job offers." />
                </Card>
              ) : offersError ? (
                <ErrorState message="Offers could not be refreshed. We will try again shortly." onRetry={() => void fetchOffers()} />
              ) : offers.length === 0 ? (
                <Card>
                  <EmptyState icon="radio-outline" title="Waiting for the next job" message="New offers appear here automatically." />
                </Card>
              ) : (
                <View style={{ gap: Spacing.md }}>
                  {offers.map((o) => {
                    const dist = metresToKm(o.distance_at_offer_m);
                    return (
                      <Pressable
                        key={o.assignment_id}
                        onPress={() => nav.navigate("IncomingOffer", { jobId: o.job_id, assignmentId: o.assignment_id, offerData: o })}
                        accessibilityRole="button"
                        accessibilityLabel={`Job offer: ${o.job.service_name ?? "roadside job"}. Open.`}
                        style={styles.offerCard}
                      >
                        <View style={styles.offerTop}>
                          <Text style={styles.offerTitle} numberOfLines={1}>{o.job.service_name ?? "Roadside job"}</Text>
                          <OfferTimer offer={o} />
                        </View>
                        <Text style={styles.muted} numberOfLines={2}>{o.job.pickup_address_text ?? "Pickup location"}</Text>
                        <View style={styles.offerMeta}>
                          {dist ? <Text style={styles.metaText}>{dist} away</Text> : null}
                          {o.estimated_arrival_min != null ? <Text style={styles.metaText}>about {o.estimated_arrival_min} min</Text> : null}
                          {o.job.vehicle_number ? <Text style={styles.metaText}>{o.job.vehicle_number}</Text> : null}
                          {o.job.price_estimate != null ? <Text style={[styles.metaText, { color: Colors.brand700 }]}>{inr(o.job.price_estimate)}</Text> : null}
                        </View>
                        <Text style={styles.offerCta}>View offer</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Stats */}
            <View>
              <SectionHeader title="Your standing" />
              {loading ? (
                <Skeleton height={88} />
              ) : stats ? (
                <View style={styles.statRow}>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => nav.navigate("PartnerReviews")}
                    accessibilityRole="button"
                    accessibilityLabel="See all your reviews"
                  >
                    <Stat label="Rating" value={stats.rating_count > 0 ? Number(stats.rating_avg).toFixed(1) : "New"} sub={`${stats.rating_count} ${stats.rating_count === 1 ? "review" : "reviews"} ›`} />
                  </Pressable>
                  <Stat label="Acceptance" value={`${Math.round(Number(stats.acceptance_rate_pct))}%`} sub="of offers" />
                  <Stat label="Jobs" value={String(stats.lifetime_jobs)} sub="lifetime" />
                </View>
              ) : (
                <Card><Text style={styles.muted}>Stats are not available right now.</Text></Card>
              )}
            </View>
          </ScrollView>
        )}

        {tab === "earnings" && (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title} accessibilityRole="header">Earnings</Text>
            {loading ? (
              <Skeleton height={120} />
            ) : earnings ? (
              <>
                <View style={styles.statRow}>
                  <Stat label="Today" value={inr(earnings.today_amount)} sub={`${earnings.today_jobs} ${earnings.today_jobs === 1 ? "job" : "jobs"}`} />
                  <Stat label="This week" value={inr(earnings.week_amount)} sub={`${earnings.week_jobs} ${earnings.week_jobs === 1 ? "job" : "jobs"}`} />
                </View>
                <Card>
                  <Text style={styles.statLabel}>Lifetime</Text>
                  <Text style={styles.big}>{inr(earnings.lifetime_amount)}</Text>
                  <Text style={styles.muted}>{earnings.lifetime_jobs} completed {earnings.lifetime_jobs === 1 ? "job" : "jobs"}. Amounts are the final prices you entered on completion.</Text>
                </Card>
              </>
            ) : (
              <ErrorState message="Earnings could not be loaded." onRetry={() => void load()} />
            )}

            <View>
              <SectionHeader title="Recent jobs" />
              {jobs.length === 0 ? (
                <Card><EmptyState icon="time-outline" title="No jobs yet" message="Completed jobs will appear here." /></Card>
              ) : (
                <Card noPad>
                  {jobs.slice(0, 15).map((j, i, arr) => (
                    <ListRow
                      key={j.id}
                      title={j.service_name ?? "Roadside job"}
                      subtitle={`${j.vehicle_number ?? ""}${j.vehicle_number ? " · " : ""}${new Date(j.requested_at ?? j.created_at ?? Date.now()).toLocaleDateString([], { day: "numeric", month: "short" })}`}
                      right={<StatusChip status={j.status} />}
                      last={i === arr.length - 1}
                    />
                  ))}
                </Card>
              )}
            </View>
          </ScrollView>
        )}

        {tab === "account" && (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title} accessibilityRole="header">Account</Text>
            <Card>
              <View style={styles.profile}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name ?? "P").trim().charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Pressable onPress={() => setEditNameOpen(true)} accessibilityRole="button" accessibilityLabel="Edit your name"
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}>
                    <Text style={styles.name}>{user?.name ?? "Service partner"}</Text>
                    <Ionicons name="create-outline" size={18} color={Colors.brand700} />
                  </Pressable>
                  {user?.phone ? <Text style={styles.muted}>{user.phone}</Text> : null}
                  {verification ? (
                    <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name={verified ? "shield-checkmark" : "shield-outline"} size={16} color={verified ? Colors.success : Colors.warning} />
                      <Text style={[styles.verText, { color: verified ? Colors.success : Colors.warning }]}>
                        {verified ? "Verified by Sahayak" : `Verification: ${verification.replace(/_/g, " ")}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>

            {/* Collapsible Services Table */}
            <View>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">
                    Services & Capabilities
                  </Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>
                      {services.length - pausedServices.length} of {services.length} live
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setServicesCollapsed(!servicesCollapsed)}
                  style={styles.toggleCollapseBtn}
                  hitSlop={8}
                >
                  <Text style={styles.toggleCollapseText}>
                    {servicesCollapsed ? "Expand" : "Collapse"}
                  </Text>
                  <Ionicons
                    name={servicesCollapsed ? "chevron-down" : "chevron-up"}
                    size={16}
                    color={Colors.brand700}
                  />
                </Pressable>
              </View>

              {!servicesCollapsed ? (
                <Card noPad>
                  {/* Table Header */}
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableHeaderCell, { flex: 2 }]}>SERVICE & SCOPE</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: "right" }]}>
                      BASE RATE
                    </Text>
                  </View>

                  {services.length === 0 ? (
                    <View style={{ padding: Spacing.base }}>
                      <Text style={styles.muted}>
                        {loading ? "Loading service matrix…" : "No services linked yet."}
                      </Text>
                    </View>
                  ) : (
                    services.map((s, i) => (
                      <View
                        key={s.service_id}
                        style={[
                          styles.tableRow,
                          i < services.length - 1 && styles.tableRowBorder,
                        ]}
                      >
                        <View style={{ flex: 2, gap: 4 }}>
                          <Text style={styles.serviceNameText}>{s.name}</Text>
                          {s.dispatchable === false ? (
                            <View style={styles.pausedChip}>
                              <Ionicons name="alert-circle" size={13} color={Colors.warning} />
                              <Text style={styles.pausedChipText}>Needs a verified tow vehicle</Text>
                            </View>
                          ) : (
                            <View style={styles.liveChip}>
                              <View style={styles.liveChipDot} />
                              <Text style={styles.liveChipText}>Receiving jobs</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flex: 1, alignItems: "flex-end", justifyContent: "center" }}>
                          <Text style={styles.servicePriceText}>
                            {s.base_price != null ? `From ₹${s.base_price}` : "Standard"}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}

                  <View style={styles.tableFooterNote}>
                    <Ionicons name="information-circle-outline" size={15} color={Colors.textMuted} />
                    <Text style={styles.tableFooterText}>
                      {pausedServices.length > 0
                        ? "Towing needs a tow vehicle verified by Sahayak. Contact the Sahayak team to add one."
                        : "Base rates are the starting quote owners see."}
                    </Text>
                  </View>
                </Card>
              ) : (
                <Card>
                  <Pressable
                    onPress={() => setServicesCollapsed(false)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <View style={{ gap: 2 }}>
                      <Text style={styles.serviceNameText}>
                        {services.length - pausedServices.length} of {services.length} services receiving jobs
                      </Text>
                      <Text style={styles.serviceMetaText}>Tap to see rates and status</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.brand700} />
                  </Pressable>
                </Card>
              )}
            </View>

            {/* Operational Settings & Preferences */}
            <View>
              <SectionHeader title="Operational Settings" />
              <Card noPad>
                <ListRow
                  icon="notifications-outline"
                  title="Sound and vibration"
                  subtitle="New offers ring and vibrate. Change it in your phone's notification settings."
                  onPress={() => void Linking.openSettings()}
                />
                <ListRow
                  icon="navigate-outline"
                  title="Navigation app"
                  subtitle={NAV_APP_LABEL[navApp]}
                  onPress={() => {
                    showDialog("Navigation app", "Which app should open when you tap Navigate on a job?", [
                      { text: NAV_APP_LABEL.google, onPress: () => chooseNavApp("google") },
                      { text: NAV_APP_LABEL.system, onPress: () => chooseNavApp("system") },
                      { text: "Cancel", style: "cancel" },
                    ]);
                  }}
                  last
                />
              </Card>
            </View>

            {/* Partner Dispatch & Support */}
            <View>
              <SectionHeader title="Partner Helpline & Legal" />
              <Card noPad>
                <ListRow
                  icon="call-outline"
                  title="24/7 Dispatch Control Room"
                  subtitle={SUPPORT_PHONE_DISPLAY}
                  onPress={() => void Linking.openURL(SUPPORT_PHONE_TEL)}
                />
                {WEB_URL ? (
                  <>
                    <ListRow
                      icon="document-text-outline"
                      title="Partner terms of service"
                      onPress={() => void Linking.openURL(`${WEB_URL}/terms`)}
                    />
                    <ListRow
                      icon="lock-closed-outline"
                      title="Partner privacy policy"
                      onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}
                      last
                    />
                  </>
                ) : (
                  <ListRow
                    icon="shield-checkmark-outline"
                    title="Sahayak Partner Network"
                    subtitle="Version 1.2.0 (Build 44)"
                    last
                  />
                )}
              </Card>
            </View>

            <Button label="Sign out" variant="outline" onPress={confirmSignOut} />
          </ScrollView>
        )}
      </View>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`}>
      <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.screenHorizontal, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  bell: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginRight: -8 },
  bellDot: { position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.emergency, borderWidth: 2, borderColor: Colors.surfaceWhite },
  brandText: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  dutyPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 8, paddingHorizontal: 16, minHeight: 40, borderRadius: Radius.full, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.16)", borderColor: "rgba(255,255,255,0.22)" },
  dutyOn: { backgroundColor: Colors.successLight, borderColor: "#86EFAC" },
  dutyOff: { backgroundColor: "#F1F5F9", borderColor: Colors.border },
  dutyDot: { width: 8, height: 8, borderRadius: 4 },
  dutyText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium, color: "#fff" },
  body: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: TAB_BAR_SPACE + 16 },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  muted: { fontSize: Typography.fontSize.base, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 21 },

  shiftRow: { flexDirection: "row", alignItems: "center", gap: Spacing.base },
  shiftTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, marginBottom: 4 },
  locBtn: { marginTop: Spacing.base, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.md },
  locText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  verifyBanner: { marginTop: Spacing.md, flexDirection: "row", gap: 8, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.warningLight },
  verifyText: { flex: 1, fontSize: Typography.fontSize.sm, color: Colors.warning, fontFamily: Typography.fontFamily.medium, lineHeight: 19 },
  errBanner: { flexDirection: "row", gap: 8, alignItems: "center", padding: Spacing.md, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.errorLight },
  errText: { flex: 1, fontSize: Typography.fontSize.sm, color: Colors.error, fontFamily: Typography.fontFamily.medium },

  activeCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.brand700, backgroundColor: Colors.brand700Muted },
  activeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  activeKicker: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700Dark },
  activeTitle: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },

  offerCard: { padding: Spacing.base, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.brand700, backgroundColor: Colors.surfaceWhite, gap: 6 },
  offerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.sm },
  offerTitle: { flex: 1, fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  offerAge: { fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.medium },
  offerMeta: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md, marginTop: 2 },
  metaText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary },
  offerCta: { marginTop: 6, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.bold, color: Colors.brand700 },

  statRow: { flexDirection: "row", gap: Spacing.sm },
  stat: { flex: 1, minWidth: 0, backgroundColor: Colors.surfaceWhite, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.base, paddingHorizontal: Spacing.md },
  pausedChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: Colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  pausedChipText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.warning },
  liveChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  liveChipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveChipText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium, color: Colors.success },
  statLabel: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  statValue: { marginTop: 4, fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  statSub: { marginTop: 2, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
  big: { marginTop: 4, marginBottom: 6, fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },

  profile: { flexDirection: "row", alignItems: "center", gap: Spacing.base },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold },
  name: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  verText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.sm },
  sectionTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  countBadge: { backgroundColor: Colors.brand700Light, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  countBadgeText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.bold, color: Colors.brand700Dark },
  toggleCollapseBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  toggleCollapseText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },

  tableHeaderRow: { flexDirection: "row", backgroundColor: "#F8FAFC", paddingHorizontal: Spacing.base, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  tableHeaderCell: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textMuted, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.base, paddingVertical: 12 },
  tableRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  serviceNameText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  serviceMetaText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  servicePriceText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold, color: Colors.brand700 },
  tableFooterNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: Spacing.base, paddingVertical: 10, backgroundColor: "#F8FAFC", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderLight },
  tableFooterText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },

  settingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.base, paddingVertical: Spacing.base, gap: Spacing.md },
  settingsDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderLight },
  settingsLabel: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  settingsSub: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted, lineHeight: 17 },
});
