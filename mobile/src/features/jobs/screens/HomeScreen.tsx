// ─── Sahayak — Uber & Rapido Hybrid Home Screen ───────────────────────────────
// Synthesizing the most impressive, cleanest UX patterns from both apps:
// 1. From Uber (Screenshots 1 & 3):
//    - Top Service Mode Switcher Tabs (🚗 Roadside Help, 📦 Spare Parts, 🛡️ RSA Pass)
//    - Personalized Search Bar ("Hi, Arjun · Where do you need help?") with "⚡ Instant SOS ▾"
//    - "For You" 8-tile Circular Service Grid with floating discount/speed badges
//    - "Save Everyday" Horizontal Promotion Carousel
//    - Floating Pill Bottom Navigation Bar (Home, Services, Activity, Account)
// 2. From Rapido (Screenshot 2):
//    - "Everything in minutes" Asymmetric Hero Feature Card (Flatbed Towing + Battery Jump)
//    - Grouped Recent & Favorite Breakdown Locations Card with ❤️ Heart Favorites
//    - Clean, modern spacing with subtle 1px border elevation
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Dimensions,
  Modal,
  Linking,
  Platform,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Radius, Shadows, Spacing } from "../../../constants/theme";
import {
  MOCK_VEHICLES,
  MOCK_USER_OWNER,
  MOCK_USER_PARTNER,
  MOCK_JOBS,
} from "../../../services/api";
import Button from "../../../components/ui/Button";
import { useAuthStore } from "../../../store/authStore";
import { useJobStore } from "../../../store/jobStore";
import type { OwnerStackParamList, ServiceType, Vehicle } from "../../../types";

import ServicesView from "../../services/screens/ServicesView";
import ActivityView from "../../activity/screens/ActivityView";
import AccountView from "../../account/screens/AccountView";
import BlinkitTopHeader from "../../../components/ui/BlinkitTopHeader";
import BlinkitBottomNavBar from "../../../components/ui/BlinkitBottomNavBar";
import MotionBanner from "../../../components/ui/MotionBanner";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type BottomTab = "home" | "services" | "activity" | "account";

interface ForYouItem {
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

const FOR_YOU_ITEMS: ForYouItem[] = [
  {
    id: "towing",
    service: "towing",
    title: "Towing",
    image: require("../../../../assets/for_you/towing.png"),
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
  },
  {
    id: "rsa_pass",
    service: "towing",
    title: "RSA Pass",
    image: require("../../../../assets/for_you/rsa_pass.png"),
  },
];

const CIRCULAR_SERVICES = FOR_YOU_ITEMS;

interface RecentPlace {
  id: string;
  name: string;
  address: string;
  isFavorite: boolean;
  serviceSuggestion: ServiceType;
}

const RECENT_PLACES: RecentPlace[] = [
  {
    id: "place_01",
    name: "Indiranagar 100 Feet Road",
    address: "HAL 2nd Stage, near 12th Main junction, Bengaluru",
    isFavorite: true,
    serviceSuggestion: "towing",
  },
  {
    id: "place_02",
    name: "PST Hostel & Tech Park",
    address: "4th Cross Road, BEML Layout, Brookefield",
    isFavorite: true,
    serviceSuggestion: "battery",
  },
  {
    id: "place_03",
    name: "Kempegowda Int'l Airport Road",
    address: "Hebbal Flyover Junction, Expressway Lane",
    isFavorite: false,
    serviceSuggestion: "tyre",
  },
];

export default function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<OwnerStackParamList>>();
  const { user, setUser, logout } = useAuthStore();
  const { setDraftPickupLocation, setDraftService } = useJobStore();

  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle>(MOCK_VEHICLES[0]);
  const [recentPlaces, setRecentPlaces] = useState<RecentPlace[]>(RECENT_PLACES);

  // Modals
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isAccountScrolled, setIsAccountScrolled] = useState(false);
  const [homeSearchQuery, setHomeSearchQuery] = useState("");
  const [serviceSearchQuery, setServiceSearchQuery] = useState("");
  const [activitySearchQuery, setActivitySearchQuery] = useState("");

  // Toggle favorite heart
  const toggleFavorite = (id: string) => {
    setRecentPlaces((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p))
    );
  };

  // Launch Service Flow on Map
  const handleLaunchService = (
    svc: ServiceType = "towing",
    address: string = "Indiranagar 100 Feet Road, Bengaluru"
  ) => {
    setDraftService(svc, selectedVehicle.id);
    setDraftPickupLocation({ latitude: 12.9716, longitude: 77.5946, address });
    nav.navigate("OwnerFlow", {
      initialStep: "service_select",
      serviceType: svc,
      pickupAddress: address,
    });
  };

  const userName = user?.name?.split(" ")[0] || "Arjun";
  const insets = useSafeAreaInsets();
  const topInset = insets.top > 0 ? insets.top : Platform.OS === "android" ? (StatusBar.currentHeight ?? 32) : 44;

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

      {/* ── TOP HEADER FOR SERVICES & ACTIVITY TABS ── */}
      {activeTab !== "account" && activeTab !== "home" && (
        <BlinkitTopHeader
          tab={activeTab}
          locationText="Indiranagar 100ft Rd, HAL 2nd Stage"
          etaText="12 minutes"
          walletBalance="₹0"
          searchQuery={
            activeTab === "services"
              ? serviceSearchQuery
              : activitySearchQuery
          }
          onSearchChange={(text) => {
            if (activeTab === "services") {
              setServiceSearchQuery(text);
            } else if (activeTab === "activity") {
              setActivitySearchQuery(text);
            }
          }}
          onLocationPress={() => handleLaunchService("towing")}
          onWalletPress={() => {
            Alert.alert(
              "Sahayak Cash",
              "Available Balance: ₹0\n\nInstant cashless breakdown dispatch with zero platform fees."
            );
          }}
          onProfilePress={() => setActiveTab("account")}
          onSearchSubmit={() => {}}
        />
      )}

      {activeTab === "home" && (
        <>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 100 }}
            keyboardShouldPersistTaps="handled"
            bounces={true}
          >
            {/* ── 1. SIGNATURE RESCUE MOTION BANNER (FULL UNIFIED ZOMATO-STYLE HERO CANVAS) ── */}
            {/* Seamless canvas: status bar + location + pill search bar + comic shards + motion loop */}
            <MotionBanner
              topInset={topInset}
              locationText="Kundalahalli - Brookefield, Bengaluru"
              etaText="In 12 minutes"
              walletBalance="₹0"
              searchPlaceholder="Search for 'mechanic, towing, flat tyre...'"
              searchQuery={homeSearchQuery}
              onSearchChange={(text) => {
                setHomeSearchQuery(text);
                if (text.trim().length > 0) {
                  setServiceSearchQuery(text);
                  setActiveTab("services");
                }
              }}
              onLocationPress={() => handleLaunchService("towing")}
              onWalletPress={() => {
                Alert.alert(
                  "Sahayak Cash",
                  "Available Balance: ₹0\n\nInstant cashless breakdown dispatch with zero platform fees."
                );
              }}
              onProfilePress={() => setActiveTab("account")}
              onSearchSubmit={() => {
                if (homeSearchQuery.trim().length > 0) {
                  setServiceSearchQuery(homeSearchQuery);
                  setActiveTab("services");
                }
              }}
              categoryTag="Roadside rescue"
              lineOneText="Get additional 25% off"
              lineTwoText="on your first booking"
              buttonLabel="Book now"
              onPress={() => handleLaunchService("towing")}
            />

            {/* ── MAIN CONTENT ON NEUTRAL GREY CANVAS ── */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>

              {/* ── 3. RECENT & FAVORITE BREAKDOWN SPOTS ── */}
              <View style={styles.recentDestinationsCard}>
                {recentPlaces.map((item, idx) => (
                  <View key={item.id}>
                    <TouchableOpacity
                      style={styles.recentRow}
                      onPress={() => handleLaunchService(item.serviceSuggestion, item.name)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.clockIconBox}>
                        <Ionicons name="time-outline" size={18} color="#5E6470" />
                      </View>

                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.recentPlaceName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.recentPlaceAddress} numberOfLines={1}>
                          {item.address}
                        </Text>
                      </View>

                      <TouchableOpacity
                        onPress={() => toggleFavorite(item.id)}
                        style={styles.heartBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons
                          name={item.isFavorite ? "heart" : "heart-outline"}
                          size={20}
                          color={item.isFavorite ? "#E23744" : "#94A3B8"}
                        />
                      </TouchableOpacity>
                    </TouchableOpacity>
                    {idx < recentPlaces.length - 1 && <View style={styles.cardDivider} />}
                  </View>
                ))}
              </View>

              {/* ── 4. "EVERYTHING IN MINUTES" SECTION ── */}
              <View style={styles.minutesHeaderRow}>
                <Text style={styles.minutesSectionTitle}>Everything in minutes</Text>
                <TouchableOpacity onPress={() => handleLaunchService("towing")} activeOpacity={0.7}>
                  <Text style={styles.viewAllText}>View Map ›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.minutesGrid}>
                {/* Large Left Hero Card: Emergency Towing */}
                <TouchableOpacity
                  style={styles.minutesHeroCard}
                  onPress={() => handleLaunchService("towing")}
                  activeOpacity={0.88}
                >
                  <View style={styles.heroTextContent}>
                    <View style={styles.startsAtBadge}>
                      <Ionicons name="flash" size={11} color="#0C831F" />
                      <Text style={styles.startsAtText}>Starts at ₹499 · 8 min</Text>
                    </View>

                    <Text style={styles.minutesHeroTitle}>Emergency Towing</Text>
                    <Text style={styles.minutesHeroSub}>
                      Flatbed tilt-deck & 2-wheeler breakdown assist
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

                {/* Right Stacked Column: Jumpstart + Flat Tyre */}
                <View style={styles.minutesRightCol}>
                  <TouchableOpacity
                    style={styles.minutesSmallCard}
                    onPress={() => handleLaunchService("battery")}
                    activeOpacity={0.85}
                  >
                    <View style={styles.smallCardTextContent}>
                      <View style={[styles.smallBadge, { backgroundColor: "#FEF6D8" }]}>
                        <Text style={[styles.smallBadgeText, { color: "#1C1C1C" }]}>₹249</Text>
                      </View>
                      <Text style={styles.smallCardTitle}>Jumpstart</Text>
                      <Text style={styles.smallCardSub}>4-min arrival</Text>
                    </View>

                    <Image
                      source={require("../../../../assets/minutes/jumpstart.png")}
                      style={styles.smallCardImageJumpstart}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.minutesSmallCard}
                    onPress={() => handleLaunchService("tyre")}
                    activeOpacity={0.85}
                  >
                    <View style={styles.smallCardTextContent}>
                      <View style={[styles.smallBadge, { backgroundColor: "#DCFCE7" }]}>
                        <Text style={[styles.smallBadgeText, { color: "#0C831F" }]}>₹199</Text>
                      </View>
                      <Text style={styles.smallCardTitle}>Flat Tyre</Text>
                      <Text style={styles.smallCardSub}>Puncture / swap</Text>
                    </View>

                    <Image
                      source={require("../../../../assets/minutes/flat_tyre.png")}
                      style={styles.smallCardImageTyre}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── 5. "FOR YOU" SECTION ── */}
              <View style={styles.forYouHeaderRow}>
                <Text style={styles.forYouSectionTitle}>For you</Text>
                <TouchableOpacity
                  style={styles.forYouArrowBtn}
                  onPress={() => handleLaunchService("towing")}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-forward" size={18} color="#1C1C1C" />
                </TouchableOpacity>
              </View>

              <View style={styles.forYouGrid}>
                {FOR_YOU_ITEMS.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.forYouItem}
                    onPress={() => handleLaunchService(item.service, `${item.title} Assist`)}
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

                      <Image
                        source={item.image}
                        style={styles.forYouImage}
                        resizeMode="contain"
                      />

                      {item.hasClock && (
                        <View style={styles.forYouClockBadge}>
                          <Ionicons name="time" size={8.5} color="#FFFFFF" />
                        </View>
                      )}
                    </View>

                    <Text style={styles.forYouTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── 6. #SAHAYAKONTHEMOVE BRAND FOOTER BANNER ── */}
              <TouchableOpacity
                style={styles.onTheMoveContainer}
                onPress={() => {
                  Alert.alert(
                    "Sahayak on the Move 🇮🇳",
                    "Keeping Indian roads moving 24/7. Verified mechanics, flatbed tow trucks, and rapid roadside assistance across Bengaluru and beyond.\n\nEmergency Helpline: 1800-SAHAYAK"
                  );
                }}
                activeOpacity={0.94}
              >
                <Image
                  source={require("../../../../assets/minutes/sahayak_on_the_move.png")}
                  style={styles.onTheMoveImage}
                  resizeMode="cover"
                />
                <View style={styles.onTheMoveTextOverlay}>
                  <Text style={styles.onTheMoveHashtag}>#SahayakOnTheMove</Text>
                  <Text style={styles.onTheMoveSubtitle}>Keeping India moving 24/7 🇮🇳</Text>
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </>
      )}

      {/* ── 2. SERVICES TAB VIEW ── */}
      {activeTab === "services" && (
        <View style={{ flex: 1, backgroundColor: "#F5F6F8" }}>
          <ServicesView
            onLaunchService={handleLaunchService}
            selectedVehicle={selectedVehicle}
            onOpenVehicleModal={() => setShowVehicleModal(true)}
            onOpenSos={() => setShowSosModal(true)}
            searchQuery={serviceSearchQuery}
          />
        </View>
      )}

      {/* ── 3. ACTIVITY TAB VIEW ── */}
      {activeTab === "activity" && (
        <View style={{ flex: 1, backgroundColor: "#F5F6F8" }}>
          <ActivityView
            onLaunchService={handleLaunchService}
            onOpenSos={() => setShowSosModal(true)}
            searchQuery={activitySearchQuery}
          />
        </View>
      )}

      {/* ── 4. ACCOUNT TAB VIEW ── */}
      {activeTab === "account" && (
        <AccountView
          selectedVehicle={selectedVehicle}
          onSelectVehicle={setSelectedVehicle}
          onOpenVehicleModal={() => setShowVehicleModal(true)}
          onOpenSos={() => setShowSosModal(true)}
          onGoToTab={(tab) => setActiveTab(tab)}
          onScrollStateChange={setIsAccountScrolled}
        />
      )}

      {/* ── 8. BLINKIT DYNAMIC BOTTOM NAVIGATION BAR ── */}
      <BlinkitBottomNavBar
        activeTab={activeTab}
        onTabPress={(tab) => setActiveTab(tab)}
      />

      {/* ── MODAL 1: PROFILE & SAVED VEHICLES ── */}
      <Modal
        visible={showProfileModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowProfileModal(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Account & Vehicles</Text>
              <TouchableOpacity onPress={() => setShowProfileModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.profileUserCard}>
              <View style={styles.profileAvatarLarge}>
                <Text style={styles.profileInitials}>AS</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{MOCK_USER_OWNER.name}</Text>
                <Text style={styles.profilePhone}>{MOCK_USER_OWNER.phone}</Text>
                <View style={styles.verifiedTag}>
                  <Ionicons name="checkmark-circle" size={12} color={Colors.brand700} />
                  <Text style={styles.verifiedTagText}>Sahayak Verified Owner</Text>
                </View>
              </View>
            </View>

            <Text style={styles.modalSectionTitle}>Registered Vehicles</Text>
            {MOCK_VEHICLES.map((v) => {
              const isSelected = v.id === selectedVehicle.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleSelectCard, isSelected && styles.vehicleSelectCardActive]}
                  onPress={() => {
                    setSelectedVehicle(v);
                    setShowProfileModal(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={v.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={22}
                    color={isSelected ? Colors.brand700 : Colors.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleSelectName}>
                      {v.make} {v.model}
                    </Text>
                    <Text style={styles.vehicleSelectPlate}>{v.licensePlate}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.brand700} />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Developer Mode Switch */}
            <Text style={styles.modalSectionTitle}>Developer Quick-Switch</Text>
            <TouchableOpacity
              style={styles.switchRoleCard}
              onPress={() => {
                setShowProfileModal(false);
                setUser(MOCK_USER_PARTNER, "mock_jwt_partner");
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="swap-horizontal" size={18} color={Colors.brand700} />
              <Text style={styles.switchRoleText}>Switch to Partner Mode (Test Offers)</Text>
            </TouchableOpacity>

            {/* Logout */}
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => {
                setShowProfileModal(false);
                logout();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={18} color="#E23744" />
              <Text style={styles.logoutBtnText}>Log Out (Test Splash & Login Flow)</Text>
            </TouchableOpacity>

            <Button
              label="Close"
              onPress={() => setShowProfileModal(false)}
              variant="outline"
              size="md"
              fullWidth
              style={{ marginTop: 14 }}
            />
          </SafeAreaView>
        </View>
      </Modal>

      {/* ── MODAL 2: EMERGENCY SOS ASSISTANCE ── */}
      <Modal
        visible={showSosModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSosModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sosCard}>
            <View style={styles.sosHeader}>
              <View style={styles.sosFlashCircle}>
                <Ionicons name="flash" size={28} color="#FFFFFF" />
              </View>
              <Text style={styles.sosTitle}>Emergency Roadside SOS</Text>
              <Text style={styles.sosSubtitle}>
                Immediate 24/7 helplines & live GPS broadcast
              </Text>
            </View>

            <View style={styles.sosList}>
              <TouchableOpacity
                style={styles.sosItem}
                onPress={() => Linking.openURL("tel:112")}
                activeOpacity={0.8}
              >
                <View style={styles.sosItemIcon}>
                  <Ionicons name="call" size={18} color="#E23744" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosItemTitle}>National Emergency Helpline</Text>
                  <Text style={styles.sosItemSub}>Police, Ambulance, Fire (112)</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sosItem}
                onPress={() => Linking.openURL("tel:103")}
                activeOpacity={0.8}
              >
                <View style={styles.sosItemIcon}>
                  <Ionicons name="car" size={18} color={Colors.brand700} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosItemTitle}>Traffic Police & Highway Patrol</Text>
                  <Text style={styles.sosItemSub}>Accident & Towing Dispatch (103)</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sosItem}
                onPress={() => {
                  setShowSosModal(false);
                  Alert.alert(
                    "SOS SMS Broadcast",
                    "Emergency SOS broadcast with your live coordinates (12.9716, 77.5946) sent to registered emergency contacts."
                  );
                }}
                activeOpacity={0.8}
              >
                <View style={styles.sosItemIcon}>
                  <Ionicons name="navigate" size={18} color="#1C1C1C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosItemTitle}>Auto-share live GPS on SOS</Text>
                  <Text style={styles.sosItemSub}>
                    Emergency contacts will receive SMS tracking link during breakdown
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Button
              label="Dismiss SOS"
              onPress={() => setShowSosModal(false)}
              variant="outline"
              size="md"
              fullWidth
              style={{ marginTop: 16 }}
            />
          </View>
        </View>
      </Modal>

      {/* ── MODAL 3: VEHICLE PICKER MODAL ── */}
      <Modal
        visible={showVehicleModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowVehicleModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.vehicleModalCard}>
            <Text style={styles.modalSectionTitle}>Select Breakdown Vehicle</Text>
            {MOCK_VEHICLES.map((v) => {
              const isSelected = v.id === selectedVehicle.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleSelectCard, isSelected && styles.vehicleSelectCardActive]}
                  onPress={() => {
                    setSelectedVehicle(v);
                    setShowVehicleModal(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={v.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={22}
                    color={isSelected ? Colors.brand700 : Colors.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleSelectName}>
                      {v.make} {v.model} ({v.year})
                    </Text>
                    <Text style={styles.vehicleSelectPlate}>{v.licensePlate}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.brand700} />
                  )}
                </TouchableOpacity>
              );
            })}
            <Button
              label="Cancel"
              onPress={() => setShowVehicleModal(false)}
              variant="outline"
              size="sm"
              fullWidth
              style={{ marginTop: 12 }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },

  // ─── BLINKIT YELLOW HERO HEADER ───
  yellowHero: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  yellowHeroTransition: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  heroBannerCard: {
    width: "100%",
    aspectRatio: 1376 / 768,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#F8CB46",
    elevation: 3,
    shadowColor: "#1C1C1C",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(220, 180, 50, 0.4)",
  },
  heroBannerImage: {
    width: "100%",
    height: "100%",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  heroLocationCol: {
    flex: 1,
    paddingRight: 12,
  },
  heroLocationLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  heroLocationLabel: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.3,
  },
  heroAddressText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E4A1E",
    paddingLeft: 18,
  },
  heroRightIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 2,
  },
  heroSearchBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
  },

  // Promise Strip (Blinkit "NO EXTRA CHARGES" style)
  promiseStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    marginBottom: 12,
  },
  promiseCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  promiseNO: {
    fontSize: 20,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "900",
    color: "#1C1C1C",
    letterSpacing: -0.5,
  },
  promiseLabel: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#5E6470",
    textAlign: "center",
    letterSpacing: 0.3,
    lineHeight: 13,
  },
  promiseDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#EFF1F5",
  },

  // SOS Emergency Strip inside Hero
  heroSosStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  heroSosLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroSosFlash: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FDECEA",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSosTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  heroSosSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 1,
  },

  // Old header/SOS styles kept for modals compatibility
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 36 : 6,
    paddingBottom: 8,
    backgroundColor: "#F5F6F8",
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    gap: 6,
    maxWidth: SCREEN_WIDTH * 0.65,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0C831F",
  },
  locationPillText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: "#1C1C1C",
  },
  sosButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E23744",
    gap: 4,
    elevation: 3,
    shadowColor: "#E23744",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  sosButtonText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
    letterSpacing: 0.5,
  },

  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },

  // Personalized Search Bar
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    marginTop: 4,
  },
  searchBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  searchIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F5F6F8",
    alignItems: "center",
    justifyContent: "center",
  },
  searchGreeting: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.3,
  },
  searchPlaceholder: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 1,
  },
  searchDivider: {
    width: 1,
    height: 22,
    backgroundColor: "#EFF1F5",
    marginHorizontal: 8,
  },
  instantPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FDE68A",
    gap: 4,
  },
  instantPillText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.1,
  },

  // Recent Destinations Card (Uber Screenshot 3 + Rapido Hearts)
  recentDestinationsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  clockIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  recentPlaceName: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.2,
  },
  recentPlaceAddress: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 16,
  },
  heartBtn: {
    padding: 6,
  },
  cardDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginLeft: 48,
  },

  // Section Headers
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.4,
  },
  viewAllText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: Colors.brand700,
  },

  // Everything in Minutes Section (Screenshot Match)
  minutesHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  minutesSectionTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.4,
  },
  minutesGrid: {
    flexDirection: "row",
    gap: 10,
    height: 220,
  },
  minutesHeroCard: {
    flex: 1.55,
    height: 220,
    backgroundColor: "#F3F7FA",
    borderRadius: 24,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 0,
    justifyContent: "space-between",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  heroTextContent: {
    alignItems: "flex-start",
  },
  startsAtBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.full,
    gap: 4,
    marginBottom: 6,
  },
  startsAtText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
    letterSpacing: 0.1,
  },
  minutesHeroTitle: {
    fontSize: 18.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.3,
  },
  minutesHeroSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 15,
  },
  heroGraphicWrapper: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: "auto",
  },
  heroGraphicImage: {
    width: "100%",
    height: 126,
  },
  minutesRightCol: {
    flex: 1,
    height: 220,
    gap: 10,
    justifyContent: "space-between",
  },
  minutesSmallCard: {
    flex: 1,
    backgroundColor: "#F3F7FA",
    borderRadius: 22,
    paddingTop: 12,
    paddingLeft: 12,
    paddingRight: 8,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
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
    marginBottom: 5,
  },
  smallBadgeText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
  },
  smallCardTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.3,
  },
  smallCardSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  smallCardImageJumpstart: {
    position: "absolute",
    right: -6,
    bottom: -6,
    width: 68,
    height: 68,
  },
  smallCardImageTyre: {
    position: "absolute",
    right: -4,
    bottom: -6,
    width: 68,
    height: 68,
  },

  // "For You" Section (Exact Uber Match)
  forYouHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  forYouSectionTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.4,
  },
  forYouArrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  forYouGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 18,
  },
  forYouItem: {
    width: (SCREEN_WIDTH - 32) / 4,
    alignItems: "center",
  },
  forYouCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  forYouImage: {
    width: 52,
    height: 52,
  },
  forYouRedBadge: {
    position: "absolute",
    top: -5,
    alignSelf: "center",
    backgroundColor: "#E00000",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    zIndex: 5,
    elevation: 3,
  },
  forYouBadgeText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.1,
  },
  forYouClockBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
  },
  forYouTitle: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#000000",
    textAlign: "center",
    letterSpacing: -0.2,
  },

  // Vehicle Strip
  vehicleStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 14,
    elevation: 1,
  },
  vehicleStripLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  vehicleIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.brand700Light,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleStripTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.2,
  },
  vehicleStripSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  switchPill: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  switchPillText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: Colors.brand700,
  },

  // Promo Carousel
  promoCarousel: {
    gap: 12,
  },
  promoCard: {
    width: SCREEN_WIDTH * 0.76,
    borderRadius: Radius.xl,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  promoCardTag: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: Colors.brand700Light,
    letterSpacing: 1,
  },
  promoCardHeading: {
    fontSize: 16.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 4,
    letterSpacing: -0.3,
  },
  promoCardSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255, 255, 255, 0.88)",
    marginTop: 3,
  },

  // #SahayakOnTheMove Brand Footer Banner (Ola Style - Till Icons Only)
  onTheMoveContainer: {
    marginTop: 20,
    marginBottom: 6,
    height: 380,
    backgroundColor: "#EFF4F7",
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.8)",
  },
  onTheMoveImage: {
    width: "100%",
    height: "100%",
  },
  onTheMoveTextOverlay: {
    position: "absolute",
    top: 20,
    left: 18,
    right: 18,
    alignItems: "flex-start",
  },
  onTheMoveHashtag: {
    fontSize: 24,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.5,
  },
  onTheMoveSubtitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#3D3D3D",
    marginTop: 4,
    letterSpacing: -0.2,
  },

  // Bottom Navigation Bar (Docked, Never Overlapping)
  bottomNavContainer: {
    backgroundColor: "#FFFFFF",
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 20 : 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    alignItems: "center",
  },
  bottomNavBar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.full,
    height: 52,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    borderRadius: Radius.full,
    gap: 2,
  },
  navTabActive: {
    backgroundColor: "#0F172A",
  },
  navLabel: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textSecondary,
  },
  navLabelActive: {
    color: "#FFFFFF",
    fontFamily: Typography.fontFamily.bold,
  },
  accountIconContainer: {
    position: "relative",
  },
  accountDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#1C1C1C",
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: 20,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalHeaderTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  profileUserCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    marginBottom: 16,
  },
  profileAvatarLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.brand700,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitials: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: "#FFFFFF",
  },
  profileName: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  profilePhone: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
  },
  verifiedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  verifiedTagText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.brand700,
  },
  modalSectionTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  vehicleSelectCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 12,
    marginBottom: 8,
  },
  vehicleSelectCardActive: {
    borderColor: Colors.brand700,
    backgroundColor: Colors.brand700Muted,
  },
  vehicleSelectName: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehicleSelectPlate: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  switchRoleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.brand700Muted,
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.brand700Light,
    gap: 8,
    marginBottom: 8,
  },
  switchRoleText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDECEA",
    gap: 8,
  },
  logoutBtnText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
  },

  // SOS Modal Card
  sosCard: {
    width: "92%",
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: "auto",
    marginTop: "auto",
  },
  sosHeader: {
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  sosFlashCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E23744",
    alignItems: "center",
    justifyContent: "center",
  },
  sosTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  sosSubtitle: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  sosList: {
    gap: 8,
  },
  sosItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  sosItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sosItemTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  sosItemSub: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  vehicleModalCard: {
    width: "92%",
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: "auto",
    marginTop: "auto",
  },
});
