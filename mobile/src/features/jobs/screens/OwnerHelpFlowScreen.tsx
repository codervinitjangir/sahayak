// ─── Sahayak — Owner Continuous Help Flow (Uber Map & Bottom Sheet Language) ──
// Strictly modeled after the Uber Mobile UI Design & Prototype Animation (Figma Community):
// 1. Persistent Map Canvas as the continuous backdrop across all states
// 2. Dynamic Sliding Bottom Sheet with animated spring height changes:
//    - 'idle' (~38%): Search bar ("Need roadside help?"), Quick Suggestions (Towing, Flat Tyre, Battery, Fuel), Vehicle strip
//    - 'half' (~54%): Choose a service ride list (vehicle icon, ETA, promo pill, upfront price, payment selector, black CTA)
//    - 'peek' (~28%): Pickup confirmation & radar searching
//    - 'compact' (~44%): Partner matched with live ETA, Dominant OTP Start Code ("4821"), Driver card, Message & Call CTAs
//    - 'expanded' (~54%): Service completed summary with fare breakdown & 5-star rating
// 3. Floating Map Chrome: Profile avatar, Address chip, ⚡ SOS button, 44px back button, Recenter GPS FAB
// 4. Slide-over Profile/Vehicle Modal & SOS Assistance Modal
// 5. Zero bottom tab bar for owner — 100% continuous fluid map flow
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Alert,
  Linking,
  Modal,
  Dimensions,
  Animated,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, Spacing, Radius, ServiceConfig } from "../../../constants/theme";
import {
  MOCK_SUB_SERVICES,
  MOCK_VEHICLES,
  MOCK_PARTNER,
  MOCK_USER_OWNER,
  MOCK_USER_PARTNER,
} from "../../../services/api";
import Button from "../../../components/ui/Button";
import SharedMapCanvas from "../../../components/map/SharedMapCanvas";
import SlidingBottomSheet, { SheetHeightVariant } from "../../../components/sheet/SlidingBottomSheet";
import RatingStars from "../../../components/ui/RatingStars";
import { useJobStore } from "../../../store/jobStore";
import { useAuthStore } from "../../../store/authStore";
import type {
  OwnerStackParamList,
  ServiceType,
  LatLng,
  Vehicle,
  FlowStep,
} from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type MatchedSubState = "en_route" | "awaiting_start_code" | "in_progress";

const SERVICE_TYPES: ServiceType[] = ["towing", "tyre", "battery", "fuel", "lockout", "mechanic"];
const BENGALURU: LatLng = { latitude: 12.9716, longitude: 77.5946 };
const PARTNER_LOC: LatLng = { latitude: 12.9780, longitude: 77.6010 };

// Quick Uber Suggestion Cards for Idle Home
interface QuickSuggestion {
  type: ServiceType;
  title: string;
  subtitle: string;
  promoTag?: string;
  icon: keyof typeof Ionicons.glyphMap;
  price: number;
}

const QUICK_SUGGESTIONS: QuickSuggestion[] = [
  {
    type: "towing",
    title: "Towing",
    subtitle: "Flatbed & lift",
    promoTag: "Fastest",
    icon: "car-outline",
    price: 499,
  },
  {
    type: "tyre",
    title: "Flat Tyre",
    subtitle: "Puncture / swap",
    promoTag: "Guaranteed",
    icon: "disc-outline",
    price: 199,
  },
  {
    type: "battery",
    title: "Jumpstart",
    subtitle: "Battery boost",
    promoTag: "4 min",
    icon: "flash-outline",
    price: 299,
  },
  {
    type: "fuel",
    title: "Fuel Drop",
    subtitle: "5L Emergency",
    promoTag: "Quick",
    icon: "water-outline",
    price: 299,
  },
];

interface OwnerHelpFlowScreenProps {
  initialStep?: FlowStep;
}

export default function OwnerHelpFlowScreen({
  initialStep = "idle",
}: OwnerHelpFlowScreenProps) {
  const nav = useNavigation<NativeStackNavigationProp<OwnerStackParamList>>();
  const route = useRoute<any>();
  const { setUser, logout } = useAuthStore();

  // Store bindings
  const {
    draftPickupLocation,
    setDraftPickupLocation,
    setDraftService,
    setDraftSubService,
    setDraftNotes,
    startCode,
  } = useJobStore();

  // Active Flow Step (idle -> service_select -> pickup_location -> finding_partner -> partner_matched -> completed)
  const [step, setStep] = useState<FlowStep>(
    route.params?.initialStep ?? initialStep
  );

  // Service Selection State
  const initialSvc: ServiceType = route.params?.serviceType ?? "towing";
  const [selectedService, setSelectedService] = useState<ServiceType>(initialSvc);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(() => {
    const subs = MOCK_SUB_SERVICES[initialSvc] ?? [];
    return subs[0]?.id ?? "tow_01";
  });
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle>(MOCK_VEHICLES[0]);
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI: Google Pay •• 4032");

  // Matched State Sub-steps & Timer
  const [matchedSubState, setMatchedSubState] = useState<MatchedSubState>("awaiting_start_code");
  const [dotCount, setDotCount] = useState(1);
  const [searchProgress, setSearchProgress] = useState(0.2);

  // Completed Rating State
  const [userRating, setUserRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>(["Fast arrival", "Polite"]);

  // Modals
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [showVehiclePickerModal, setShowVehiclePickerModal] = useState(false);

  // Entities
  const userLoc = draftPickupLocation ?? BENGALURU;
  const partner = MOCK_PARTNER;
  const subServices = MOCK_SUB_SERVICES[selectedService] ?? [];
  const selectedSub = subServices.find((s) => s.id === selectedSubId) ?? subServices[0];
  const currentPrice = selectedSub?.estimatedPrice ?? 499;

  // Auto-progress from finding_partner to partner_matched after 4.2s (Uber matching simulation)
  useEffect(() => {
    if (step !== "finding_partner") return;

    setSearchProgress(0.15);
    const progressTimer = setInterval(() => {
      setSearchProgress((p) => Math.min(p + 0.22, 1));
    }, 800);

    const dotTimer = setInterval(() => {
      setDotCount((d) => (d % 3) + 1);
    }, 500);

    const matchTimer = setTimeout(() => {
      setStep("partner_matched");
      setMatchedSubState("awaiting_start_code");
    }, 4200);

    return () => {
      clearInterval(progressTimer);
      clearInterval(dotTimer);
      clearTimeout(matchTimer);
    };
  }, [step]);

  // Handle back navigation per step
  const handleBack = () => {
    if (step === "service_select") {
      if (nav.canGoBack()) {
        nav.goBack();
      } else {
        nav.navigate("OwnerHome");
      }
    } else if (step === "idle") {
      nav.navigate("OwnerHome");
    } else if (step === "pickup_location") {
      setStep("service_select");
    } else if (step === "finding_partner") {
      Alert.alert("Cancel Request?", "Are you sure you want to cancel partner search?", [
        { text: "No", style: "cancel" },
        { text: "Yes, Cancel", style: "destructive", onPress: () => setStep("service_select") },
      ]);
    } else if (step === "partner_matched") {
      Alert.alert("Cancel Breakdown Job?", "Partner is currently assigned and en route. Cancel?", [
        { text: "Keep Job", style: "cancel" },
        { text: "Cancel Job", style: "destructive", onPress: () => nav.navigate("OwnerHome") },
      ]);
    } else if (step === "completed") {
      nav.navigate("OwnerHome");
    } else {
      if (nav.canGoBack()) {
        nav.goBack();
      } else {
        nav.navigate("OwnerHome");
      }
    }
  };

  // Quick suggestion select from idle
  const handleSelectQuickSuggestion = (suggestion: QuickSuggestion) => {
    setSelectedService(suggestion.type);
    const subs = MOCK_SUB_SERVICES[suggestion.type] ?? [];
    setSelectedSubId(subs[0]?.id ?? null);
    setStep("service_select");
  };

  const handleContinueToPickup = () => {
    setDraftService(selectedService, selectedVehicle.id);
    if (selectedSub) setDraftSubService(selectedSub.id, selectedSub.estimatedPrice);
    setDraftNotes(notes);
    setStep("pickup_location");
  };

  const handleConfirmPickup = () => {
    setStep("finding_partner");
  };

  // Determine bottom sheet height per state:
  // idle -> 'idle' (~38%)
  // service_select -> 'half' (~54%)
  // pickup_location -> 'peek' (~28%)
  // finding_partner -> 'peek' (~28%)
  // partner_matched -> 'compact' (~44%)
  // completed -> 'half' (~54%)
  const sheetHeight: SheetHeightVariant =
    step === "idle"
      ? "idle"
      : step === "service_select"
      ? "half"
      : step === "partner_matched"
      ? "compact"
      : step === "completed"
      ? "half"
      : "peek";

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── 1. PERSISTENT CONTINUOUS MAP CANVAS ── */}
      <SharedMapCanvas
        userLocation={userLoc}
        partnerLocation={step === "partner_matched" ? PARTNER_LOC : null}
        showRoute={step === "partner_matched"}
        showRadar={step === "finding_partner"}
        radarRadius={900}
        draggable={step === "pickup_location"}
        onUserMarkerDragEnd={(coord) => setDraftPickupLocation(coord)}
        showAmbientPartners={step === "idle" || step === "finding_partner"}
        showFloatingButtons={step === "partner_matched"}
        onSharePress={() =>
          Alert.alert("Share Status", "Live tracking link copied to clipboard. Share with family.")
        }
        onHelpPress={() => setShowSosModal(true)}
      />

      {/* ── 2. FLOATING TOP HEADER CHROME (UBER MINIMAL AESTHETIC) ── */}
      <SafeAreaView style={styles.floatingTopBar} edges={["top"]} pointerEvents="box-none">
        {step === "idle" ? (
          // Home Top Bar: Profile avatar + Location chip + SOS emergency button
          <View style={styles.homeTopRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.floatingProfileBtn}
              onPress={() => setShowProfileModal(true)}
              activeOpacity={0.85}
              accessibilityLabel="Open profile and vehicles"
            >
              <Ionicons name="person-circle" size={28} color={Colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.floatingAddressChip}
              onPress={() => setStep("service_select")}
              activeOpacity={0.85}
            >
              <View style={styles.greenPulseDot} />
              <Text style={styles.floatingAddressText} numberOfLines={1}>
                Indiranagar 100ft Rd
              </Text>
              <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.floatingSosBtn}
              onPress={() => setShowSosModal(true)}
              activeOpacity={0.85}
              accessibilityLabel="Emergency SOS support"
            >
              <Ionicons name="flash" size={14} color={Colors.textWhite} />
              <Text style={styles.floatingSosText}>SOS</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Deep Step Top Bar: 44px Back Button + Context Status Pill + SOS Button
          <View style={styles.deepTopRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.floatingBackBtn}
              onPress={handleBack}
              activeOpacity={0.85}
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.topStatusPill}>
              <View
                style={[
                  styles.statusIndicatorDot,
                  step === "partner_matched"
                    ? styles.statusDotGreen
                    : step === "finding_partner"
                    ? styles.statusDotAmber
                    : styles.statusDotTeal,
                ]}
              />
              <Text style={styles.topStatusPillText}>
                {step === "service_select"
                  ? "Choose Breakdown Service"
                  : step === "pickup_location"
                  ? "Confirm Location"
                  : step === "finding_partner"
                  ? "Broadcasting to Mechanics"
                  : step === "partner_matched"
                  ? "Partner Assigned · 8 min away"
                  : "Service Completed"}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.floatingSosBtn}
              onPress={() => setShowSosModal(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="flash" size={14} color={Colors.textWhite} />
              <Text style={styles.floatingSosText}>SOS</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* ── 3. FLOATING RECENTER FAB BUTTON (ABOVE SHEET) ── */}
      <View style={styles.floatingFabContainer} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.floatingRecenterBtn}
          onPress={() => {
            setDraftPickupLocation(BENGALURU);
            Alert.alert("GPS Centered", "Centered on your current breakdown location.");
          }}
          activeOpacity={0.85}
          accessibilityLabel="Recenter location"
        >
          <Ionicons name="locate" size={20} color={Colors.brand700} />
        </TouchableOpacity>
      </View>

      {/* ── 4. DYNAMIC SLIDING BOTTOM SHEET (CHANGES HEIGHT PER STATE) ── */}
      <SlidingBottomSheet heightVariant={sheetHeight}>
        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE A: UBER HOME / IDLE STATE (~38% height) ─────────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "idle" && (
          <View style={styles.idleBody}>
            {/* Uber Search Bar (Where do you need help?) */}
            <TouchableOpacity
              style={styles.uberSearchBar}
              onPress={() => setStep("service_select")}
              activeOpacity={0.9}
            >
              <View style={styles.uberSearchLeft}>
                <Ionicons name="search" size={19} color={Colors.textPrimary} />
                <Text style={styles.uberSearchPlaceholder}>Where do you need help?</Text>
              </View>
              <View style={styles.searchDivider} />
              <View style={styles.uberSearchNowPill}>
                <Ionicons name="flash" size={12} color={Colors.brand700} />
                <Text style={styles.uberSearchNowText}>Now ▾</Text>
              </View>
            </TouchableOpacity>

            {/* Suggestions Header */}
            <View style={styles.suggestionsHeaderRow}>
              <Text style={styles.suggestionsTitle}>Quick Rescue Services</Text>
              <TouchableOpacity onPress={() => setStep("service_select")}>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            </View>

            {/* Uber Suggestions 4-Card Horizontal Row (Frame 3 from Figma) */}
            <View style={styles.suggestionsGrid}>
              {QUICK_SUGGESTIONS.map((item) => (
                <TouchableOpacity
                  key={item.type}
                  style={styles.suggestionCard}
                  onPress={() => handleSelectQuickSuggestion(item)}
                  activeOpacity={0.75}
                >
                  {item.promoTag && (
                    <View style={styles.suggestionPromoPill}>
                      <Text style={styles.suggestionPromoText}>{item.promoTag}</Text>
                    </View>
                  )}
                  <View style={styles.suggestionIconBox}>
                    <Ionicons name={item.icon} size={22} color={Colors.brand700} />
                  </View>
                  <Text style={styles.suggestionCardTitle}>{item.title}</Text>
                  <Text style={styles.suggestionCardPrice}>₹{item.price}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Selected Breakdown Vehicle Strip */}
            <TouchableOpacity
              style={styles.vehicleSelectStrip}
              onPress={() => setShowVehiclePickerModal(true)}
              activeOpacity={0.8}
            >
              <View style={styles.vehicleStripLeft}>
                <View style={styles.vehicleIconCircle}>
                  <Ionicons
                    name={selectedVehicle.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={16}
                    color={Colors.brand700}
                  />
                </View>
                <View>
                  <Text style={styles.vehicleStripMake}>
                    {selectedVehicle.make} {selectedVehicle.model}
                  </Text>
                  <Text style={styles.vehicleStripPlate}>{selectedVehicle.licensePlate}</Text>
                </View>
              </View>
              <View style={styles.vehicleStripRight}>
                <Text style={styles.switchVehicleText}>Switch ▾</Text>
              </View>
            </TouchableOpacity>

            {/* Instant Help CTA */}
            <Button
              label="Request Instant Breakdown Help"
              onPress={() => setStep("service_select")}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: 2 }}
            />
          </View>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE B: SERVICE SELECTION (~54% height) ──────────────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "service_select" && (
          <View style={styles.flowBody}>
            {/* Category Filter Chips Carousel */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryChipsRow}
            >
              {SERVICE_TYPES.map((svc) => {
                const cfg = ServiceConfig[svc];
                const isSelected = svc === selectedService;
                return (
                  <TouchableOpacity
                    key={svc}
                    style={[styles.categoryChip, isSelected ? styles.categoryChipSelected : styles.categoryChipUnselected]}
                    onPress={() => {
                      setSelectedService(svc);
                      const newSubs = MOCK_SUB_SERVICES[svc] ?? [];
                      setSelectedSubId(newSubs[0]?.id ?? null);
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={cfg.icon as any}
                      size={14}
                      color={isSelected ? Colors.textWhite : Colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected ? styles.categoryChipTextSelected : styles.categoryChipTextUnselected,
                      ]}
                    >
                      {cfg.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Specific Sub-Service Ride Cards (Figma Frame 4 Ride List) */}
              <Text style={styles.sectionHeading}>Choose Breakdown Option</Text>
              <View style={styles.rideItemList}>
                {subServices.map((sub) => {
                  const isSelected = sub.id === (selectedSubId ?? selectedSub?.id);
                  return (
                    <TouchableOpacity
                      key={sub.id}
                      style={[styles.rideCard, isSelected ? styles.rideCardSelected : styles.rideCardUnselected]}
                      onPress={() => setSelectedSubId(sub.id)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.rideCardLeft}>
                        <View style={[styles.rideIconWrap, isSelected && styles.rideIconWrapSelected]}>
                          <Ionicons
                            name={ServiceConfig[selectedService].icon as any}
                            size={20}
                            color={isSelected ? Colors.brand700 : Colors.secondary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.rideTitleRow}>
                            <Text style={[styles.rideTitle, isSelected && styles.rideTitleSelected]}>
                              {sub.name}
                            </Text>
                            {isSelected && (
                              <View style={styles.fasterChip}>
                                <Ionicons name="flash" size={10} color={Colors.brand700} />
                                <Text style={styles.fasterChipText}>Faster</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.rideEtaText}>4–6 min away · Verified technician</Text>
                          {sub.description ? (
                            <Text style={styles.rideDescText} numberOfLines={1}>
                              {sub.description}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <Text style={[styles.ridePriceText, isSelected && styles.ridePriceTextSelected]}>
                        ₹{sub.estimatedPrice}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Landmark or notes input */}
              <View style={styles.notesContainer}>
                <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
                <TextInput
                  style={styles.notesInput}
                  placeholder="Landmark or car breakdown note (optional)..."
                  placeholderTextColor={Colors.textMuted}
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={100}
                />
              </View>
            </ScrollView>

            {/* Uber Bottom Bar (Payment + Vehicle + Confirm Button) */}
            <View style={styles.uberBottomBar}>
              <View style={styles.paymentVehicleRow}>
                <TouchableOpacity
                  style={styles.paymentPill}
                  onPress={() =>
                    setPaymentMethod((prev) =>
                      prev.includes("UPI")
                        ? "Sahayak Cash (₹450)"
                        : prev.includes("Cash")
                        ? "Card: Visa •• 4032"
                        : "UPI: Google Pay •• 4032"
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="card-outline" size={14} color={Colors.brand700} />
                  <Text style={styles.paymentPillText}>{paymentMethod}</Text>
                  <Ionicons name="chevron-forward" size={12} color={Colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.vehiclePill}
                  onPress={() => setShowVehiclePickerModal(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="car-outline" size={14} color={Colors.textPrimary} />
                  <Text style={styles.vehiclePillText}>{selectedVehicle.model}</Text>
                </TouchableOpacity>
              </View>

              <Button
                label={`Confirm ${ServiceConfig[selectedService].label} · ₹${currentPrice}`}
                onPress={handleContinueToPickup}
                variant="primary"
                size="lg"
                fullWidth
                style={{ marginTop: Spacing.xs }}
              />
            </View>
          </View>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE C: PICKUP CONFIRMATION (~28% peek height) ───────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "pickup_location" && (
          <View style={styles.peekBody}>
            {/* Fixed Rate Upfront Chip */}
            <View style={styles.fixedRateBanner}>
              <View style={styles.fixedRateLeft}>
                <Ionicons name="shield-checkmark" size={15} color={Colors.brand700} />
                <Text style={styles.fixedRateTitle}>Upfront Guaranteed Rate</Text>
              </View>
              <Text style={styles.fixedRateAmount}>₹{currentPrice} Fixed</Text>
            </View>

            {/* Address Row */}
            <View style={styles.addressRow}>
              <View style={styles.addressPinBadge}>
                <Ionicons name="location" size={18} color={Colors.brand700} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.addressTitle}>Confirm Breakdown Spot</Text>
                <Text style={styles.addressText} numberOfLines={1}>
                  Indiranagar 100ft Road, Bengaluru
                </Text>
                <Text style={styles.dragHintText}>Map is active: Drag pin to refine spot</Text>
              </View>
            </View>

            {/* Primary Action Button */}
            <Button
              label={`Confirm Pickup & Request Partner (₹${currentPrice})`}
              onPress={handleConfirmPickup}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: Spacing.xs }}
            />
          </View>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE D: FINDING PARTNER (~28% peek height) ───────────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "finding_partner" && (
          <View style={styles.peekBody}>
            <View style={styles.searchingRow}>
              <View style={styles.searchingIconCircle}>
                <Ionicons name="search" size={20} color={Colors.brand700} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.searchingTitle}>
                  Finding your rescue partner{".".repeat(dotCount)}
                </Text>
                <Text style={styles.searchingSub}>
                  Scanning 3 verified mechanics near Indiranagar
                </Text>
              </View>
              <View style={styles.priceChip}>
                <Text style={styles.priceChipText}>₹{currentPrice} Fixed</Text>
              </View>
            </View>

            {/* Dynamic Progress Bar */}
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${searchProgress * 100}%` }]} />
            </View>

            {/* Progress rail */}
            <View style={styles.progressRail}>
              <View style={styles.progressStepDone}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.brand700} />
                <Text style={styles.progressStepDoneText}>Request Sent</Text>
              </View>
              <View style={styles.progressStepActive}>
                <View style={styles.pulseDot} />
                <Text style={styles.progressStepActiveText}>Matching Partner</Text>
              </View>
              <TouchableOpacity
                style={styles.cancelLinkBtn}
                onPress={handleBack}
                accessibilityLabel="Cancel request"
              >
                <Text style={styles.cancelLinkText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE E: PARTNER MATCHED & OTP START CODE (~44% compact) ─ */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "partner_matched" && (
          <View style={styles.flowBody}>
            {/* Live ETA Header Strip */}
            <View style={styles.matchedHeaderStrip}>
              <View style={styles.liveEtaPill}>
                <View style={styles.greenPulseDot} />
                <Text style={styles.liveEtaText}>Arriving in 4 min · 1.4 km away</Text>
              </View>
              <Text style={styles.fixedFarePill}>₹{currentPrice} Fixed</Text>
            </View>

            {/* ── 8. DOMINANT OTP START CODE HERO CARD (Focal Point) ── */}
            <View style={styles.otpHeroContainer}>
              <View style={styles.otpHeaderStrip}>
                <Ionicons name="shield-checkmark" size={15} color={Colors.brand700} />
                <Text style={styles.otpHeaderTitle}>START CODE (GIVE TO MECHANIC)</Text>
              </View>
              <Text style={styles.otpLargeDigits}>{startCode || "4821"}</Text>
              <Text style={styles.otpSubInstruction}>
                Share this 4-digit code verbally with {partner.name} to verify & begin roadside work
              </Text>
            </View>

            {/* Driver Identity Card & Vehicle Badge */}
            <View style={styles.driverDetailsCard}>
              <View style={styles.driverAvatarContainer}>
                <View style={styles.driverAvatarCircle}>
                  <Ionicons name="person" size={24} color={Colors.textSecondary} />
                </View>
                <View style={styles.ratingBadgePill}>
                  <Ionicons name="star" size={11} color="#F8CB46" />
                  <Text style={styles.ratingBadgeText}>{partner.rating}</Text>
                </View>
              </View>

              <View style={styles.driverMeta}>
                <Text style={styles.driverName}>{partner.name}</Text>
                <Text style={styles.driverTripsText}>234 rescue jobs completed</Text>
                <View style={styles.vehiclePlateTag}>
                  <Text style={styles.vehiclePlateTagText}>
                    {partner.vehicleModel} · {partner.vehicleNumber}
                  </Text>
                </View>
              </View>

              {/* Circular Action Buttons (Call + Message) */}
              <View style={styles.driverActionsRow}>
                <TouchableOpacity
                  style={styles.circleActionBtn}
                  onPress={() => Linking.openURL(`tel:${partner.phone}`)}
                  accessibilityLabel="Call partner"
                >
                  <Ionicons name="call" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.circleActionBtn}
                  onPress={() => Linking.openURL(`sms:${partner.phone}`)}
                  accessibilityLabel="Message partner"
                >
                  <Ionicons name="chatbubble-ellipses" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Primary Action Button (Service in Progress / Complete) */}
            <Button
              label={
                matchedSubState === "in_progress"
                  ? "Service In Progress · Complete Job"
                  : "Start Job (Code Verified)"
              }
              onPress={() => {
                if (matchedSubState === "awaiting_start_code") {
                  setMatchedSubState("in_progress");
                } else {
                  setStep("completed");
                }
              }}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: Spacing.xs }}
            />
          </View>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* ── STATE F: COMPLETED SUMMARY & RATING (~54% height) ─────── */}
        {/* ───────────────────────────────────────────────────────────── */}
        {step === "completed" && (
          <View style={styles.flowBody}>
            <View style={styles.completeHeader}>
              <View style={styles.completeCheckCircle}>
                <Ionicons name="checkmark" size={24} color={Colors.textWhite} />
              </View>
              <Text style={styles.completeTitle}>Service Completed!</Text>
              <Text style={styles.completeSubtitle}>
                Your vehicle is ready to drive safely.
              </Text>
            </View>

            {/* Receipt Summary */}
            <View style={styles.receiptCard}>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>
                  {ServiceConfig[selectedService].label} ({selectedSub?.name ?? "Service"})
                </Text>
                <Text style={styles.receiptValue}>₹{currentPrice - 50}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Taxes & Roadside Dispatch Fee</Text>
                <Text style={styles.receiptValue}>₹50</Text>
              </View>
              <View style={styles.receiptDivider} />
              <View style={styles.receiptRowTotal}>
                <Text style={styles.receiptTotalLabel}>Total Paid via UPI</Text>
                <Text style={styles.receiptTotalValue}>₹{currentPrice}</Text>
              </View>
            </View>

            {/* 5-Star Rating Input */}
            <View style={styles.ratingSection}>
              <Text style={styles.ratingPrompt}>Rate your experience with {partner.name}</Text>
              <RatingStars
                value={userRating}
                size={28}
                readonly={false}
                onChange={(v: number) => setUserRating(v)}
              />
            </View>

            {/* Done Button */}
            <Button
              label="Done · Return to Map"
              onPress={() => setStep("idle")}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: Spacing.xs }}
            />
          </View>
        )}
      </SlidingBottomSheet>

      {/* ── MODAL 1: PROFILE & SAVED VEHICLES SLIDE-OVER ── */}
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
              <TouchableOpacity
                onPress={() => setShowProfileModal(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* User Profile Card */}
            <View style={styles.profileCard}>
              <View style={styles.profileAvatarLarge}>
                <Text style={styles.profileInitials}>AS</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{MOCK_USER_OWNER.name}</Text>
                <Text style={styles.profilePhone}>{MOCK_USER_OWNER.phone}</Text>
                <View style={styles.verifiedTag}>
                  <Ionicons name="checkmark-circle" size={12} color={Colors.brand700} />
                  <Text style={styles.verifiedTagText}>Verified Sahayak Owner</Text>
                </View>
              </View>
            </View>

            {/* Registered Vehicles */}
            <Text style={styles.modalSectionTitle}>Registered Vehicles</Text>
            {MOCK_VEHICLES.map((v) => {
              const isCurrent = v.id === selectedVehicle.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleOptionCard, isCurrent && styles.vehicleOptionCardActive]}
                  onPress={() => {
                    setSelectedVehicle(v);
                    setShowProfileModal(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={v.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={20}
                    color={isCurrent ? Colors.brand700 : Colors.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleOptionName}>
                      {v.make} {v.model} ({v.year})
                    </Text>
                    <Text style={styles.vehicleOptionPlate}>{v.licensePlate}</Text>
                  </View>
                  {isCurrent ? (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.brand700} />
                  ) : (
                    <Text style={styles.selectText}>Select</Text>
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Switch Role (Test Partner Flow) */}
            <Text style={styles.modalSectionTitle}>Developer Quick-Switch</Text>
            <TouchableOpacity
              style={styles.switchRoleBtn}
              onPress={() => {
                setShowProfileModal(false);
                setUser(MOCK_USER_PARTNER, "mock_jwt_partner");
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="swap-horizontal" size={18} color={Colors.brand700} />
              <Text style={styles.switchRoleBtnText}>Switch to Partner Mode (Test Offers)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.switchRoleBtn,
                { borderColor: "#FDECEA", backgroundColor: "#FEF2F2", marginTop: 8 },
              ]}
              onPress={() => {
                setShowProfileModal(false);
                logout();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={18} color="#E23744" />
              <Text style={[styles.switchRoleBtnText, { color: "#E23744" }]}>
                Log Out (Test Splash & Login Flow)
              </Text>
            </TouchableOpacity>

            <Button
              label="Close"
              onPress={() => setShowProfileModal(false)}
              variant="outline"
              size="md"
              fullWidth
              style={{ marginTop: 16 }}
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
        <View style={styles.sosModalOverlay}>
          <View style={styles.sosModalCard}>
            <View style={styles.sosModalHeader}>
              <View style={styles.sosFlashCircle}>
                <Ionicons name="flash" size={26} color={Colors.textWhite} />
              </View>
              <Text style={styles.sosModalTitle}>Emergency Roadside SOS</Text>
              <Text style={styles.sosModalSub}>
                Direct 24/7 helplines & automated live location broadcast
              </Text>
            </View>

            <View style={styles.sosActionsList}>
              <TouchableOpacity
                style={styles.sosHelplineRow}
                onPress={() => Linking.openURL("tel:112")}
                activeOpacity={0.8}
              >
                <View style={styles.sosHelplineIcon}>
                  <Ionicons name="call" size={18} color="#E23744" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosHelplineTitle}>National Emergency Helpline</Text>
                  <Text style={styles.sosHelplineSub}>Police, Ambulance, Fire (112)</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sosHelplineRow}
                onPress={() => Linking.openURL("tel:103")}
                activeOpacity={0.8}
              >
                <View style={styles.sosHelplineIcon}>
                  <Ionicons name="car" size={18} color={Colors.brand700} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosHelplineTitle}>Traffic Police & Highway Patrol</Text>
                  <Text style={styles.sosHelplineSub}>Accident & Towing Dispatch (103)</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sosHelplineRow}
                onPress={() => {
                  setShowSosModal(false);
                  Alert.alert(
                    "SOS SMS Broadcast",
                    "Emergency SOS with your live coordinates (12.9716, 77.5946) sent to registered emergency contacts."
                  );
                }}
                activeOpacity={0.8}
              >
                <View style={styles.sosHelplineIcon}>
                  <Ionicons name="navigate" size={18} color="#1C1C1C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sosHelplineTitle}>Broadcast Live GPS via SMS</Text>
                  <Text style={styles.sosHelplineSub}>Alert saved family & emergency contacts</Text>
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
        visible={showVehiclePickerModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowVehiclePickerModal(false)}
      >
        <View style={styles.sosModalOverlay}>
          <View style={styles.sosModalCard}>
            <Text style={styles.modalSectionTitle}>Select Breakdown Vehicle</Text>
            {MOCK_VEHICLES.map((v) => {
              const isSelected = v.id === selectedVehicle.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.vehicleOptionCard, isSelected && styles.vehicleOptionCardActive]}
                  onPress={() => {
                    setSelectedVehicle(v);
                    setShowVehiclePickerModal(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={v.type === "two-wheeler" ? "bicycle" : "car-sport"}
                    size={20}
                    color={isSelected ? Colors.brand700 : Colors.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleOptionName}>
                      {v.make} {v.model} ({v.year})
                    </Text>
                    <Text style={styles.vehicleOptionPlate}>{v.licensePlate}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.brand700} />
                  )}
                </TouchableOpacity>
              );
            })}
            <Button
              label="Cancel"
              onPress={() => setShowVehiclePickerModal(false)}
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
  container: {
    flex: 1,
    backgroundColor: "#F1F5F9",
  },
  flowBody: {
    flex: 1,
    gap: 8,
  },
  idleBody: {
    flex: 1,
    gap: 10,
  },
  peekBody: {
    gap: 10,
  },

  // Floating Top Header Chrome
  floatingTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 15,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 36 : 10,
  },
  homeTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deepTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  floatingProfileBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  floatingBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  floatingAddressChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
    maxWidth: SCREEN_WIDTH * 0.55,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  floatingAddressText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  greenPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0C831F",
  },
  floatingSosBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "#E23744",
    gap: 4,
    elevation: 4,
    shadowColor: "#E23744",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  floatingSosText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
    letterSpacing: 0.5,
  },
  topStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  statusIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusDotGreen: { backgroundColor: "#0C831F" },
  statusDotAmber: { backgroundColor: "#F8CB46" },
  statusDotTeal: { backgroundColor: Colors.brand700 },
  topStatusPillText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },

  // Floating Recenter FAB
  floatingFabContainer: {
    position: "absolute",
    right: 16,
    bottom: "40%",
    zIndex: 15,
  },
  floatingRecenterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },

  // Idle Home Screen Components (Matching Figma Frame 3)
  uberSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F1F5F9",
    borderRadius: Radius.full,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  uberSearchLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  uberSearchPlaceholder: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  searchDivider: {
    width: 1,
    height: 18,
    backgroundColor: Colors.border,
    marginHorizontal: 8,
  },
  uberSearchNowPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  uberSearchNowText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
  },

  suggestionsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  suggestionsTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  seeAllText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
  },
  suggestionsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  suggestionCard: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },
  suggestionPromoPill: {
    position: "absolute",
    top: -7,
    backgroundColor: Colors.brand700,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.full,
  },
  suggestionPromoText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  suggestionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.brand700Muted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    marginTop: 2,
  },
  suggestionCardTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  suggestionCardPrice: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
    marginTop: 1,
  },

  // Vehicle Strip
  vehicleSelectStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleStripLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  vehicleIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.brand700Muted,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleStripMake: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehicleStripPlate: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
  },
  vehicleStripRight: {},
  switchVehicleText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },

  // Service Selection (State B)
  categoryChipsRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  categoryChipSelected: {
    backgroundColor: Colors.brand700,
    borderColor: Colors.brand700,
  },
  categoryChipUnselected: {
    backgroundColor: "#F8FAFC",
    borderColor: Colors.border,
  },
  categoryChipText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
  },
  categoryChipTextSelected: {
    color: Colors.textWhite,
  },
  categoryChipTextUnselected: {
    color: Colors.textSecondary,
  },

  sectionHeading: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 4,
  },
  rideItemList: {
    gap: 6,
  },
  rideCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
  },
  rideCardSelected: {
    backgroundColor: Colors.brand700Muted,
    borderColor: Colors.brand700,
  },
  rideCardUnselected: {
    backgroundColor: "#FFFFFF",
    borderColor: Colors.border,
  },
  rideCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  rideIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  rideIconWrapSelected: {
    backgroundColor: Colors.brand700Light,
  },
  rideTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rideTitle: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#000000",
    letterSpacing: -0.2,
  },
  rideTitleSelected: {
    color: Colors.brand700,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
  },
  fasterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.brand700Light,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  fasterChipText: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: Colors.brand700,
  },
  rideEtaText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#545454",
    marginTop: 2,
  },
  rideDescText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#757575",
    marginTop: 1,
  },
  ridePriceText: {
    fontSize: 16.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.2,
  },
  ridePriceTextSelected: {
    color: Colors.brand700,
  },
  notesContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 8,
    gap: 8,
  },
  notesInput: {
    flex: 1,
    fontSize: 13.5,
    color: Colors.textPrimary,
    paddingVertical: 4,
  },

  // Uber Bottom Bar
  uberBottomBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 6,
  },
  paymentVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  paymentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  paymentPillText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehiclePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehiclePillText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },

  // Pickup Confirmation Styles
  fixedRateBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.brand700Muted,
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.brand700Light,
  },
  fixedRateLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fixedRateTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  fixedRateAmount: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addressPinBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.brand700Light,
    alignItems: "center",
    justifyContent: "center",
  },
  addressTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  addressText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  dragHintText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.brand700,
    marginTop: 2,
  },

  // Finding Partner Styles
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchingIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.brand700Light,
    alignItems: "center",
    justifyContent: "center",
  },
  searchingTitle: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  searchingSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  priceChip: {
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priceChipText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 4,
    backgroundColor: Colors.brand700,
    borderRadius: 2,
  },
  progressRail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  progressStepDone: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  progressStepDoneText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
  },
  progressStepActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.brand700,
  },
  progressStepActiveText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  cancelLinkBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  cancelLinkText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
  },

  // Partner Matched & OTP Card Styles (Figma Frame 8)
  matchedHeaderStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liveEtaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  liveEtaText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: "#166534",
  },
  fixedFarePill: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  otpHeroContainer: {
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 2,
  },
  otpHeaderStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  otpHeaderTitle: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
    letterSpacing: 0.8,
  },
  otpLargeDigits: {
    fontSize: 32,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    letterSpacing: 8,
    lineHeight: 38,
    textAlign: "center",
  },
  otpSubInstruction: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  driverDetailsCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    gap: 10,
  },
  driverAvatarContainer: {
    position: "relative",
  },
  driverAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  ratingBadgePill: {
    position: "absolute",
    bottom: -4,
    right: -4,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
  },
  ratingBadgeText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  driverMeta: {
    flex: 1,
  },
  driverName: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  driverTripsText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  vehiclePlateTag: {
    alignSelf: "flex-start",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 3,
  },
  vehiclePlateTagText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  driverActionsRow: {
    flexDirection: "row",
    gap: 6,
  },
  circleActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Completed Step Styles
  completeHeader: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  completeCheckCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0C831F",
    alignItems: "center",
    justifyContent: "center",
  },
  completeTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  completeSubtitle: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
  },
  receiptCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 6,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  receiptLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
  },
  receiptValue: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  receiptRowTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptTotalLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  receiptTotalValue: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  ratingSection: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  ratingPrompt: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textSecondary,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: 20,
    maxHeight: "80%",
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
  modalCloseBtn: {
    padding: 4,
  },
  profileCard: {
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
    color: Colors.textWhite,
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
  vehicleOptionCard: {
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
  vehicleOptionCardActive: {
    borderColor: Colors.brand700,
    backgroundColor: Colors.brand700Muted,
  },
  vehicleOptionName: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehicleOptionPlate: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  selectText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  switchRoleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.brand700Muted,
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.brand700Light,
    gap: 8,
  },
  switchRoleBtnText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },

  // SOS Modal
  sosModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sosModalCard: {
    width: "100%",
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sosModalHeader: {
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
  sosModalTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  sosModalSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  sosActionsList: {
    gap: 8,
  },
  sosHelplineRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  sosHelplineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sosHelplineTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  sosHelplineSub: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
});
