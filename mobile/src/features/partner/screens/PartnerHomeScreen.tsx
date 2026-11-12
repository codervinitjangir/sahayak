// ─── Sahayak — Partner Home Screen (Matching Owner UI/UX) ───────────────────────
// Seamless Citilink/Blinkit Aesthetic:
// 1. Signature Golden Amber Hero Canvas & MotionBanner
// 2. Interactive Duty Radar & Live GPS Location Pinpoint
// 3. Operations & Daily Earnings Bento Grid (matching "Everything in minutes")
// 4. "My Rescue Capabilities" 8-tile circular grid with 3D isometric renders
// 5. High-polish cards with subtle borders, soft elevation, and status pills
// 6. Floating capsule BlinkitBottomNavBar with 4 dedicated Partner tabs:
//    - Dashboard, Fleet & Tools, Rescues, Profile
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  StatusBar,
  Dimensions,
  Platform,
  Alert,
  Image,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Location from "expo-location";

import {
  Colors,
  Typography,
  Spacing,
  Radius,
  Shadows,
  ServiceConfig,
} from "../../../constants/theme";
import Card from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/Badge";
import { useAuthStore } from "../../../store/authStore";
import { useJobStore } from "../../../store/jobStore";
import { jobsApi, BackendPartnerOfferItem } from "../../../services/api/jobs";
import { partnerApi, MobilePartnerTrustStats } from "../../../services/api/partner";
import type { PartnerStackParamList, ServiceType, Job } from "../../../types";

import BlinkitTopHeader from "../../../components/ui/BlinkitTopHeader";
import BlinkitBottomNavBar, { BottomTab } from "../../../components/ui/BlinkitBottomNavBar";
import MotionBanner from "../../../components/ui/MotionBanner";
import AccountView from "../../account/screens/AccountView";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Nav = NativeStackNavigationProp<PartnerStackParamList, "PartnerHome">;

interface CapabilityTile {
  id: string;
  service: ServiceType;
  title: string;
  image: any;
  badge?: {
    type: "tag" | "promo";
    text: string;
  };
  hasClock?: boolean;
}

const CAPABILITY_TILES: CapabilityTile[] = [
  {
    id: "towing",
    service: "towing",
    title: "Towing",
    image: require("../../../../assets/for_you/towing.png"),
    badge: { type: "tag", text: "Heavy" },
  },
  {
    id: "tyre",
    service: "tyre",
    title: "Flat Tyre",
    image: require("../../../../assets/for_you/tyre.png"),
    badge: { type: "tag", text: "25%" },
  },
  {
    id: "battery",
    service: "battery",
    title: "Jumpstart",
    image: require("../../../../assets/for_you/battery.png"),
    hasClock: true,
  },
  {
    id: "fuel",
    service: "fuel",
    title: "Fuel Drop",
    image: require("../../../../assets/for_you/fuel.png"),
    badge: { type: "tag", text: "100%" },
  },
  {
    id: "mechanic",
    service: "mechanic",
    title: "Mechanic",
    image: require("../../../../assets/for_you/mechanic.png"),
    badge: { type: "promo", text: "Promo" },
  },
  {
    id: "lockout",
    service: "lockout",
    title: "Lockout",
    image: require("../../../../assets/for_you/lockout.png"),
    badge: { type: "promo", text: "Promo" },
  },
  {
    id: "ev_boost",
    service: "battery",
    title: "EV Boost",
    image: require("../../../../assets/for_you/ev_boost.png"),
    badge: { type: "tag", text: "Fast" },
  },
  {
    id: "rsa_pass",
    service: "towing",
    title: "Heavy Winch",
    image: require("../../../../assets/for_you/rsa_pass.png"),
  },
];

export default function PartnerHomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const { isOnline, setOnline } = useJobStore();
  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [liveOffers, setLiveOffers] = useState<BackendPartnerOfferItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentLocationText, setCurrentLocationText] = useState(
    "Indiranagar 100ft Rd, Bengaluru"
  );
  const [isLocating, setIsLocating] = useState(false);

  const [partnerStats, setPartnerStats] = useState<MobilePartnerTrustStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  useEffect(() => {
    partnerApi.getStats().then(setPartnerStats).catch(() => {});
    jobsApi.listMyJobs().then((res) => {
      const mapped: Job[] = (res.items || []).map((bj) => {
        let st: ServiceType = "mechanic";
        if (bj.service_code.includes("towing")) st = "towing";
        else if (bj.service_code.includes("tyre")) st = "tyre";
        else if (bj.service_code.includes("battery")) st = "battery";
        else if (bj.service_code.includes("fuel")) st = "fuel";
        else if (bj.service_code.includes("lockout")) st = "lockout";
        return {
          id: bj.id,
          ownerId: bj.user_id,
          vehicleId: bj.vehicle_id,
          serviceType: st,
          status: bj.status === "completed" ? "complete" : (bj.status as any),
          pickupLocation: {
            latitude: bj.pickup_lat,
            longitude: bj.pickup_lng,
            address: bj.pickup_address_text || "Bengaluru",
          },
          estimatedPrice: Number(bj.price_estimate || 499),
          finalPrice: Number(bj.price_final || bj.price_estimate || 499),
          createdAt: bj.created_at,
        };
      });
      setRecentJobs(mapped);
    }).catch(() => {});
  }, []);

  const partner = {
    rating: partnerStats?.rating_avg ? Number(partnerStats.rating_avg) : 5.0,
    earningsToday: 0,
    totalJobs: partnerStats?.lifetime_jobs || 0,
  };

  const insets = useSafeAreaInsets();
  const topInset =
    insets.top > 0
      ? insets.top
      : Platform.OS === "android"
      ? (StatusBar.currentHeight ?? 32)
      : 44;

  // Poll real incoming offers when on duty
  useEffect(() => {
    if (!isOnline) {
      setLiveOffers([]);
      return;
    }
    let isMounted = true;
    const fetchOffers = async () => {
      try {
        const offers = await jobsApi.getOffers();
        if (isMounted) setLiveOffers(offers);
      } catch {
        // fallback to idle state
      }
    };
    void fetchOffers();
    const interval = setInterval(fetchOffers, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOnline]);

  const toggleOnline = (val: boolean) => {
    setOnline(val);
  };

  // GPS Location Pinpoint
  const handleDetectLocation = async () => {
    if (isLocating) return;
    try {
      setIsLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location Permission",
          "Please grant GPS location permission to enable high-accuracy rescue dispatch.",
          [{ text: "OK" }]
        );
        setIsLocating(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      try {
        const reverseList = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        if (reverseList && reverseList.length > 0) {
          const addr = reverseList[0];
          const name = addr.name || addr.street || addr.district || "Bengaluru";
          const city = addr.city || addr.subregion || "Bengaluru";
          setCurrentLocationText(`${name}, ${city}`);
        }
      } catch {
        setCurrentLocationText(`${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E`);
      }
      Alert.alert(
        "Radar Location Updated",
        `Dispatch radius anchored to ${currentLocationText}. You will receive nearby rescue alerts.`,
        [{ text: "OK" }]
      );
    } catch {
      Alert.alert("GPS Fix", "Could not acquire satellite fix. Using Indiranagar Base.");
    } finally {
      setIsLocating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F6F8" }}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={
          activeTab === "home" || activeTab === "account"
            ? "transparent"
            : "#F8CB46"
        }
        translucent={activeTab === "home" || activeTab === "account"}
      />

      {/* ── TOP HEADER FOR SERVICES & RESCUES TABS ── */}
      {activeTab !== "account" && activeTab !== "home" && (
        <BlinkitTopHeader
          tab={activeTab}
          locationText={currentLocationText}
          etaText={isOnline ? "On Duty · 5km" : "Offline"}
          walletBalance={`₹${partner.earningsToday || 1450}`}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onLocationPress={handleDetectLocation}
          onWalletPress={() => {
            Alert.alert(
              "Partner Earnings & Payout",
              `Available Settlement Balance: ₹${partner.earningsToday || 1450}\n\nBank: HDFC Bank **** 4812\nInstant Payouts available 24x7.`
            );
          }}
          onProfilePress={() => setActiveTab("account")}
          onSearchSubmit={() => {}}
        />
      )}

      {/* ── 1. DASHBOARD TAB VIEW ── */}
      {activeTab === "home" && (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          bounces={true}
        >
          {/* ── SIGNATURE AMBER HERO CANVAS & MOTION BANNER ── */}
          <MotionBanner
            topInset={topInset}
            locationText={currentLocationText}
            etaText={isOnline ? "On Duty · 5km" : "Offline"}
            walletBalance={`₹${partner.earningsToday || 1450}`}
            searchPlaceholder="Search rescues, tickets, customers..."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onLocationPress={handleDetectLocation}
            onWalletPress={() => {
              Alert.alert(
                "Partner Earnings & Payout",
                `Available Settlement Balance: ₹${partner.earningsToday || 1450}\n\nBank: HDFC Bank **** 4812\nInstant Payouts available 24x7.`
              );
            }}
            onProfilePress={() => setActiveTab("account")}
            onSearchSubmit={() => {}}
            categoryTag="Partner Priority"
            lineOneText="1.5x Surge Pricing Active"
            lineTwoText="High demand in Indiranagar"
            buttonLabel={isOnline ? "Active Radar" : "Go Online"}
            heroImage={require("../../../../assets/hero_mechanic_clean.png")}
            onPress={() => toggleOnline(!isOnline)}
          />

          {/* ── MAIN CONTENT ON CITILINK WARM CANVAS ── */}
          <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
            {/* ── 1. DUTY RADAR & LIVE DISPATCH CARD (MATCHING CURRENT LOCATION ROW) ── */}
            <View style={styles.radarCard}>
              <View style={styles.radarCardRow}>
                <View style={styles.radarLeftGroup}>
                  <View
                    style={[
                      styles.radarPulseCircle,
                      { backgroundColor: isOnline ? "#0C831F" : "#94A3B8" },
                    ]}
                  >
                    <Ionicons
                      name={isOnline ? "radio" : "radio-outline"}
                      size={20}
                      color="#FFFFFF"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.radarTitleRow}>
                      <Text style={styles.radarTitle}>
                        {isOnline ? "Rescue Dispatch Radar Active" : "Partner Radar Offline"}
                      </Text>
                      <View
                        style={[
                          styles.statusPillBadge,
                          {
                            backgroundColor: isOnline ? "#E6F4EA" : "#F1F5F9",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            { color: isOnline ? "#0C831F" : "#64748B" },
                          ]}
                        >
                          {isOnline ? "LIVE" : "PAUSED"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.radarSubtitle} numberOfLines={1}>
                      {isOnline
                        ? `Auto-accepting roadside rescues within 5 km of ${currentLocationText}`
                        : "Toggle online to start receiving instant roadside breakdown dispatches"}
                    </Text>
                  </View>
                </View>

                <Switch
                  value={isOnline}
                  onValueChange={toggleOnline}
                  trackColor={{ false: "#CBD5E1", true: "#0C831F" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#CBD5E1"
                />
              </View>

              {/* Relocate Pinpoint Quick Bar */}
              <TouchableOpacity
                style={styles.relocateBar}
                onPress={handleDetectLocation}
                activeOpacity={0.7}
              >
                <Ionicons name="navigate-circle" size={16} color="#0C831F" />
                <Text style={styles.relocateText}>
                  {isLocating
                    ? "Acquiring satellite GPS coordinates..."
                    : `Anchored: ${currentLocationText} · Tap to calibrate`}
                </Text>
                {isLocating ? (
                  <ActivityIndicator size="small" color="#0C831F" />
                ) : (
                  <Ionicons name="refresh" size={14} color="#64748B" />
                )}
              </TouchableOpacity>
            </View>

            {/* ── 2. INCOMING RESCUE OFFER BANNER (PULSING GOLDEN RADAR) ── */}
            {isOnline && liveOffers.length > 0 && liveOffers.map((off) => (
              <TouchableOpacity
                key={off.assignment_id}
                style={[styles.incomingAlertCard, Shadows.button]}
                onPress={() =>
                  nav.navigate("IncomingOffer", {
                    jobId: off.job_id,
                    assignmentId: off.assignment_id,
                    offerData: off,
                  })
                }
                activeOpacity={0.88}
              >
                <View style={styles.incomingLeft}>
                  <View style={styles.incomingPulseIcon}>
                    <Ionicons name="flash" size={22} color="#1C1C1C" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.incomingTitle}>Breakdown Rescue Request!</Text>
                      <View style={styles.liveTagBadge}>
                        <Text style={styles.liveTagText}>1.5x SURGE</Text>
                      </View>
                    </View>
                    <Text style={styles.incomingSubtitle}>
                      {off.service_code.replace(/_/g, " ")} · {off.distance_km} km away · ₹{off.price_estimate}
                    </Text>
                  </View>
                </View>
                <View style={styles.acceptButtonPill}>
                  <Text style={styles.acceptButtonText}>Review</Text>
                  <Ionicons name="arrow-forward" size={14} color="#1C1C1C" />
                </View>
              </TouchableOpacity>
            ))}

            {isOnline && liveOffers.length === 0 && (
              <TouchableOpacity
                style={[styles.incomingAlertCard, Shadows.button]}
                onPress={() => nav.navigate("IncomingOffer", { jobId: "job_003" })}
                activeOpacity={0.88}
              >
                <View style={styles.incomingLeft}>
                  <View style={styles.incomingPulseIcon}>
                    <Ionicons name="flash" size={22} color="#1C1C1C" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.incomingTitle}>Nearby Breakdown Signal!</Text>
                      <View style={styles.liveTagBadge}>
                        <Text style={styles.liveTagText}>HIGH PRIORITY</Text>
                      </View>
                    </View>
                    <Text style={styles.incomingSubtitle}>
                      Battery Jump Start · 2.1 km away · ₹299 payout
                    </Text>
                  </View>
                </View>
                <View style={styles.acceptButtonPill}>
                  <Text style={styles.acceptButtonText}>Review</Text>
                  <Ionicons name="arrow-forward" size={14} color="#1C1C1C" />
                </View>
              </TouchableOpacity>
            )}

            {/* ── 3. ASYMMETRIC BENTO GRID (TWIN OF "EVERYTHING IN MINUTES") ── */}
            <View style={styles.minutesSectionHeaderRow}>
              <Text style={styles.minutesSectionTitle}>Operations in minutes</Text>
              <TouchableOpacity
                onPress={() => setActiveTab("activity")}
                activeOpacity={0.7}
              >
                <Text style={styles.minutesViewMapText}>Full History ›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.minutesGrid}>
              {/* Left Large Hero Card: Today's Earnings & Payout */}
              <TouchableOpacity
                style={styles.minutesHeroCard}
                onPress={() => {
                  Alert.alert(
                    "Instant Payout",
                    `Today's Earnings: ₹${partner.earningsToday || 1450}\n\nProcessed via UPI / IMPS instant transfer to HDFC Bank **** 4812.`
                  );
                }}
                activeOpacity={0.85}
              >
                <View style={styles.minutesHeroContent}>
                  <View style={styles.heroGreenBadge}>
                    <Text style={styles.heroGreenBadgeText}>🟢 +18% Today</Text>
                  </View>
                  <Text style={styles.minutesHeroAmount}>
                    ₹{partner.earningsToday || 1450}
                  </Text>
                  <Text style={styles.minutesHeroTitle}>Today's Earnings</Text>
                  <Text style={styles.minutesHeroSub}>
                    5 completed rescues · 100% acceptance
                  </Text>
                </View>

                <View style={styles.heroGraphicWrapper}>
                  <Image
                    source={require("../../../../assets/minutes/hero_rescue_clean.png")}
                    style={styles.heroGraphicImage}
                    resizeMode="contain"
                  />
                </View>
              </TouchableOpacity>

              {/* Right Column: 2 Stacked Cards */}
              <View style={styles.minutesRightCol}>
                {/* Right Top Card: Partner Rating */}
                <TouchableOpacity
                  style={styles.minutesSmallCard}
                  onPress={() => {
                    Alert.alert(
                      "Partner Rating & Score",
                      "Current Rating: 4.9⭐ (142 reviews)\n\n• On-time arrival: 98%\n• Technical completion: 100%\n• Safety compliant: Yes"
                    );
                  }}
                  activeOpacity={0.85}
                >
                  <View style={styles.smallCardTextContent}>
                    <View
                      style={[
                        styles.smallBadge,
                        { backgroundColor: "#FEF6D8" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.smallBadgeText,
                          { color: "#1C1C1C" },
                        ]}
                      >
                        Top 5% Partner
                      </Text>
                    </View>
                    <Text style={styles.smallCardTitle}>4.9 ★ Rating</Text>
                    <Text style={styles.smallCardSub}>142 verified reviews</Text>
                  </View>

                  <Image
                    source={require("../../../../assets/minutes/jumpstart.png")}
                    style={styles.smallCardImageJumpstart}
                    resizeMode="contain"
                  />
                </TouchableOpacity>

                {/* Right Bottom Card: Total Earned Lifetime */}
                <TouchableOpacity
                  style={styles.minutesSmallCard}
                  onPress={() => setActiveTab("activity")}
                  activeOpacity={0.85}
                >
                  <View style={styles.smallCardTextContent}>
                    <View
                      style={[
                        styles.smallBadge,
                        { backgroundColor: "#E6F4EA" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.smallBadgeText,
                          { color: "#0C831F" },
                        ]}
                      >
                        Settled
                      </Text>
                    </View>
                    <Text style={styles.smallCardTitle}>₹128.4K</Text>
                    <Text style={styles.smallCardSub}>Total Lifetime Earned</Text>
                  </View>

                  <Image
                    source={require("../../../../assets/minutes/flat_tyre.png")}
                    style={styles.smallCardImageTyre}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── 4. "MY CAPABILITIES" 8-TILE CIRCULAR GRID (MATCHING "FOR YOU") ── */}
            <View style={styles.forYouHeaderRow}>
              <Text style={styles.forYouSectionTitle}>Active capabilities</Text>
              <TouchableOpacity
                style={styles.forYouArrowBtn}
                onPress={() => setActiveTab("services")}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={18} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            <View style={styles.forYouGrid}>
              {CAPABILITY_TILES.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.forYouItem}
                  onPress={() => {
                    Alert.alert(
                      `${item.title} Capability`,
                      `Status: ACTIVE & VERIFIED\nEquipment: Calibrated & Ready\nStandard Payout: ₹249 - ₹899 per rescue.`
                    );
                  }}
                  activeOpacity={0.75}
                >
                  <View style={styles.forYouCircle}>
                    {item.badge && (
                      <View style={styles.forYouRedBadge}>
                        {item.badge.type === "tag" && (
                          <Ionicons
                            name="pricetag"
                            size={8}
                            color="#FFFFFF"
                            style={{ marginRight: 2 }}
                          />
                        )}
                        <Text style={styles.forYouBadgeText}>{item.badge.text}</Text>
                      </View>
                    )}

                    {item.hasClock && (
                      <View style={styles.forYouClockBadge}>
                        <Ionicons name="time" size={9} color="#F8CB46" />
                      </View>
                    )}

                    <Image
                      source={item.image}
                      style={styles.forYouImage}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.forYouTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── 5. RECENT RESCUES SECTION (ELEVATED CARDS) ── */}
            <View style={styles.rescuesSectionHeaderRow}>
              <Text style={styles.forYouSectionTitle}>Recent Rescues</Text>
              <TouchableOpacity
                onPress={() => setActiveTab("activity")}
                activeOpacity={0.7}
              >
                <Text style={styles.seeAllText}>See All ›</Text>
              </TouchableOpacity>
            </View>

            {recentJobs.slice(0, 3).map((job) => {
              const svc = ServiceConfig[job.serviceType];
              return (
                <Card key={job.id} style={styles.rescueCard} noPad>
                  <View style={styles.rescueInner}>
                    <View style={[styles.rescueIconBox, { backgroundColor: svc.bg }]}>
                      <Ionicons name={svc.icon as any} size={20} color={svc.color} />
                    </View>
                    <View style={styles.rescueInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.rescueServiceTitle}>{svc.label}</Text>
                        <View style={styles.verifiedMiniTag}>
                          <Ionicons name="checkmark-circle" size={11} color="#0C831F" />
                          <Text style={styles.verifiedMiniText}>Done</Text>
                        </View>
                      </View>
                      <Text style={styles.rescueAddress} numberOfLines={1}>
                        {job.pickupLocation.address || "Indiranagar 100ft Road, Bengaluru"}
                      </Text>
                      <Text style={styles.rescueVehicleText}>
                        Tata Nexon EV · Completed in 14 mins
                      </Text>
                    </View>
                    <View style={styles.rescueRight}>
                      <Text style={styles.rescueEarningText}>+₹{job.finalPrice || 299}</Text>
                      <StatusBadge status={job.status} />
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ── 2. FLEET & TOOLS (SERVICES) TAB VIEW ── */}
      {activeTab === "services" && (
        <ScrollView
          style={{ flex: 1, backgroundColor: "#F5F6F8" }}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.fleetHeaderCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fleetHeaderTitle}>Fleet & Equipment Readiness</Text>
              <Text style={styles.fleetHeaderSub}>
                All 6 roadside breakdown categories verified and active for auto-dispatch.
              </Text>
            </View>
            <View style={styles.activeFleetBadge}>
              <Ionicons name="shield-checkmark" size={16} color="#0C831F" />
              <Text style={styles.activeFleetText}>Verified</Text>
            </View>
          </View>

          <Text style={styles.tabSectionHeadline}>Equipped Services & Rates</Text>

          {[
            {
              id: "towing",
              title: "Flatbed & Wheel-Lift Towing",
              vehicle: "Eicher Pro Flatbed (KA03-ME-9021)",
              baseRate: "₹899 Base + ₹35/km",
              icon: "car-sport",
              color: "#3B82F6",
              active: true,
            },
            {
              id: "battery",
              title: "Jumpstart & EV Booster",
              vehicle: "12V/24V Multi-Vehicle Booster Pack",
              baseRate: "₹299 Fixed",
              icon: "battery-charging",
              color: "#EAB308",
              active: true,
            },
            {
              id: "tyre",
              title: "Tyre Replacement & Puncture",
              vehicle: "High-Pressure Hydraulic Jack + Inflator",
              baseRate: "₹249 Fixed",
              icon: "disc",
              color: "#10B981",
              active: true,
            },
            {
              id: "fuel",
              title: "Emergency Fuel Delivery",
              vehicle: "Safety Certified Spill-Proof Jerry Cans",
              baseRate: "₹199 Delivery + Fuel Cost",
              icon: "water",
              color: "#F97316",
              active: true,
            },
            {
              id: "mechanic",
              title: "On-Site Mechanical Triage",
              vehicle: "Comprehensive Metric Toolset & OBD-II",
              baseRate: "₹499 Base Inspection",
              icon: "construct",
              color: "#8B5CF6",
              active: true,
            },
          ].map((svc) => (
            <Card key={svc.id} style={styles.serviceToolCard} noPad>
              <View style={styles.serviceToolInner}>
                <View
                  style={[
                    styles.serviceToolIcon,
                    { backgroundColor: `${svc.color}15` },
                  ]}
                >
                  <Ionicons name={svc.icon as any} size={22} color={svc.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.serviceToolTitle}>{svc.title}</Text>
                  <Text style={styles.serviceToolSub}>{svc.vehicle}</Text>
                  <Text style={styles.serviceToolRate}>{svc.baseRate}</Text>
                </View>
                <Switch
                  value={svc.active}
                  onValueChange={() => {
                    Alert.alert(
                      "Service Status",
                      `${svc.title} status updated. Dispatch algorithm synced.`
                    );
                  }}
                  trackColor={{ false: "#CBD5E1", true: "#0C831F" }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}

      {/* ── 3. RESCUES (ACTIVITY) TAB VIEW ── */}
      {activeTab === "activity" && (
        <ScrollView
          style={{ flex: 1, backgroundColor: "#F5F6F8" }}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Earnings Summary Card */}
          <View style={styles.summaryEarningsBanner}>
            <LinearGradient
              colors={["#1C1C1C", "#2A2A2A"]}
              style={styles.summaryGradient}
            >
              <View>
                <Text style={styles.summaryBannerSub}>Weekly Total Payout</Text>
                <Text style={styles.summaryBannerAmount}>₹9,840</Text>
                <Text style={styles.summaryBannerCount}>
                  24 Rescues Completed · 100% Customer Satisfaction
                </Text>
              </View>
              <TouchableOpacity
                style={styles.summaryPayoutBtn}
                onPress={() => {
                  Alert.alert(
                    "Instant Settlement",
                    "₹9,840 transferred to HDFC Bank **** 4812. Reference: IMPS-78410294."
                  );
                }}
              >
                <Text style={styles.summaryPayoutBtnText}>Withdraw</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>

          <Text style={styles.tabSectionHeadline}>Rescue History</Text>

          {recentJobs.map((job) => {
            const svc = ServiceConfig[job.serviceType];
            return (
              <Card key={job.id} style={styles.rescueCard} noPad>
                <View style={styles.rescueInner}>
                  <View style={[styles.rescueIconBox, { backgroundColor: svc.bg }]}>
                    <Ionicons name={svc.icon as any} size={20} color={svc.color} />
                  </View>
                  <View style={styles.rescueInfo}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.rescueServiceTitle}>{svc.label}</Text>
                      <View style={styles.verifiedMiniTag}>
                        <Ionicons name="checkmark-circle" size={11} color="#0C831F" />
                        <Text style={styles.verifiedMiniText}>Complete</Text>
                      </View>
                    </View>
                    <Text style={styles.rescueAddress} numberOfLines={1}>
                      {job.pickupLocation.address}
                    </Text>
                    <Text style={styles.rescueVehicleText}>
                      Customer Rating: 5.0 ⭐ · Arrived in 9 mins
                    </Text>
                  </View>
                  <View style={styles.rescueRight}>
                    <Text style={styles.rescueEarningText}>+₹{job.finalPrice || 299}</Text>
                    <StatusBadge status={job.status} />
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}

      {/* ── 4. PROFILE (ACCOUNT) TAB VIEW ── */}
      {activeTab === "account" && (
        <AccountView
          onGoToTab={(t) => setActiveTab(t)}
        />
      )}

      {/* ── DYNAMIC FLOATING BLINKIT BOTTOM NAVIGATION BAR ── */}
      <BlinkitBottomNavBar
        activeTab={activeTab}
        onTabPress={(tab) => setActiveTab(tab)}
        labels={{
          home: "Dashboard",
          services: "Fleet",
          activity: "Rescues",
          account: "Profile",
        }}
      />
    </View>
  );
}

// ─── STYLES (MATCHING OWNER SCREEN PIXEL-FOR-PIXEL) ───────────────────────────
const styles = StyleSheet.create({
  // Radar & Duty Card
  radarCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  radarCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  radarLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    paddingRight: 12,
  },
  radarPulseCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  radarTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  radarTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  statusPillBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  radarSubtitle: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    lineHeight: 15,
  },
  relocateBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 6,
  },
  relocateText: {
    flex: 1,
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    color: "#475569",
  },

  // Incoming Alert Banner
  incomingAlertCard: {
    backgroundColor: "#F8CB46",
    borderRadius: 20,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E5B933",
  },
  incomingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },
  incomingPulseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  incomingTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  liveTagBadge: {
    backgroundColor: "#E23744",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  liveTagText: {
    fontSize: 8.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  incomingSubtitle: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#2A2A2A",
    marginTop: 2,
  },
  acceptButtonPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  acceptButtonText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  // Bento Grid (Everything in minutes twin)
  minutesSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  minutesSectionTitle: {
    fontSize: 20,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.4,
  },
  minutesViewMapText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#B45309",
  },
  minutesGrid: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  minutesHeroCard: {
    flex: 1.08,
    height: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  minutesHeroContent: {
    alignItems: "flex-start",
    zIndex: 2,
  },
  heroGreenBadge: {
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    marginBottom: 6,
  },
  heroGreenBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#0C831F",
  },
  minutesHeroAmount: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#0C831F",
    letterSpacing: -0.5,
  },
  minutesHeroTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.2,
    marginTop: 1,
  },
  minutesHeroSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 14,
  },
  heroGraphicWrapper: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: "auto",
  },
  heroGraphicImage: {
    width: "100%",
    height: 100,
  },
  minutesRightCol: {
    flex: 1,
    height: 220,
    gap: 10,
    justifyContent: "space-between",
  },
  minutesSmallCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingTop: 12,
    paddingLeft: 12,
    paddingRight: 8,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    overflow: "hidden",
    position: "relative",
    justifyContent: "flex-start",
  },
  smallCardTextContent: {
    alignItems: "flex-start",
    zIndex: 2,
  },
  smallBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: Radius.full,
    marginBottom: 4,
  },
  smallBadgeText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
  },
  smallCardTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.3,
  },
  smallCardSub: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 1,
  },
  smallCardImageJumpstart: {
    position: "absolute",
    right: -6,
    bottom: -6,
    width: 60,
    height: 60,
  },
  smallCardImageTyre: {
    position: "absolute",
    right: -4,
    bottom: -6,
    width: 60,
    height: 60,
  },

  // "My Capabilities" Circular Grid (For You Twin)
  forYouHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  forYouSectionTitle: {
    fontSize: 20,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.4,
  },
  forYouArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  forYouGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 16,
  },
  forYouItem: {
    width: (SCREEN_WIDTH - 32) / 4,
    alignItems: "center",
  },
  forYouCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  forYouImage: {
    width: 48,
    height: 48,
  },
  forYouRedBadge: {
    position: "absolute",
    top: -5,
    alignSelf: "center",
    backgroundColor: "#E00000",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    zIndex: 5,
    elevation: 3,
  },
  forYouBadgeText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.1,
  },
  forYouClockBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: "#1C1C1C",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
  },
  forYouTitle: {
    marginTop: 7,
    fontSize: 12,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
    textAlign: "center",
    letterSpacing: -0.2,
  },

  // Recent Rescues Section
  rescuesSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  seeAllText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#B45309",
  },
  rescueCard: {
    marginBottom: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    elevation: 1,
  },
  rescueInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  rescueIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rescueInfo: {
    flex: 1,
  },
  rescueServiceTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  verifiedMiniTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  verifiedMiniText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    color: "#0C831F",
  },
  rescueAddress: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  rescueVehicleText: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#475569",
    marginTop: 1,
  },
  rescueRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  rescueEarningText: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#0C831F",
  },

  // Fleet & Tools Tab Styles
  fleetHeaderCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
    elevation: 1,
  },
  fleetHeaderTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    color: "#1C1C1C",
  },
  fleetHeaderSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 3,
  },
  activeFleetBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 4,
  },
  activeFleetText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: "#0C831F",
  },
  tabSectionHeadline: {
    fontSize: 17,
    fontFamily: Typography.fontFamily.bold,
    color: "#1C1C1C",
    marginBottom: 12,
  },
  serviceToolCard: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  serviceToolInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  serviceToolIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceToolTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    color: "#1C1C1C",
  },
  serviceToolSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 1,
  },
  serviceToolRate: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.semiBold,
    color: "#0C831F",
    marginTop: 2,
  },

  // Rescues / Activity Tab Styles
  summaryEarningsBanner: {
    marginBottom: 16,
    borderRadius: 22,
    overflow: "hidden",
  },
  summaryGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  summaryBannerSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "rgba(255, 255, 255, 0.75)",
  },
  summaryBannerAmount: {
    fontSize: 28,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#F8CB46",
    letterSpacing: -0.6,
    marginTop: 2,
  },
  summaryBannerCount: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: 4,
  },
  summaryPayoutBtn: {
    backgroundColor: "#F8CB46",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  summaryPayoutBtnText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
});
