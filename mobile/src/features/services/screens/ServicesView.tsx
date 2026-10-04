// ─── Sahayak — Categories Screen ──────────────────────────────────────────────
// Features:
// 1. "What happened?" symptom picker chips (plain-language → service mapping)
// 2. Vehicle-aware service filtering (hide car-only services for 2-wheelers, EV prioritization)
// 3. Recently booked shortcut row (1-tap reorder)
// 4. Promo / Coupon code system (apply FIRST50, JUMP10, SAHAYAK20 with dynamic discounts)
// 5. Expandable "What's included" checklist per service with distance breakdown
// 6. Direct "Book Now · {price}" CTA button
// 7. Clean empty state for search
// All follows AccountView grouped-card design language. No boxes.

import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "../../../constants/theme";
import type { ServiceType, Vehicle } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface ServicesViewProps {
  onLaunchService: (service: ServiceType, title?: string) => void;
  selectedVehicle: Vehicle;
  onOpenVehicleModal: () => void;
  onOpenSos: () => void;
  searchQuery?: string;
  lastBookedService?: { type: ServiceType; title: string; vehicle: string } | null;
}

type FilterCategory = "all" | "towing" | "battery" | "tyre" | "fuel" | "lockout" | "mechanic";

interface ServiceItem {
  id: string;
  service: ServiceType;
  title: string;
  category: FilterCategory;
  price: string;
  rawPrice: number;
  eta: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  whatsIncluded: string[];
  distancePricingNote?: string;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  vehicleType?: "two-wheeler" | "four-wheeler"; // undefined = both
  fuelType?: "electric"; // undefined = all fuel types
}

interface Coupon {
  code: string;
  title: string;
  discountDesc: string;
  discountAmount: number;
  applicableCategory?: FilterCategory; // undefined = all
}

const AVAILABLE_COUPONS: Coupon[] = [
  {
    code: "FIRST50",
    title: "Flat ₹50 OFF",
    discountDesc: "Welcome offer: Flat ₹50 off on any breakdown rescue",
    discountAmount: 50,
  },
  {
    code: "JUMP10",
    title: "10% OFF Jumpstart",
    discountDesc: "Save on Battery Jumpstart & EV fast boost van",
    discountAmount: 30,
    applicableCategory: "battery",
  },
  {
    code: "SAHAYAK20",
    title: "Flat ₹100 OFF Towing",
    discountDesc: "Special discount on 2-wheeler & Flatbed towing",
    discountAmount: 100,
    applicableCategory: "towing",
  },
];

// ─── SYMPTOM PICKER CHIPS ────────────────────────────────────────────────────
interface SymptomChip {
  id: string;
  emoji: string;
  label: string;
  mapsToFilter: FilterCategory;
  mapsToService: ServiceType;
}

const SYMPTOM_CHIPS: SymptomChip[] = [
  { id: "s1", emoji: "🔋", label: "Won't start / Click sound", mapsToFilter: "battery", mapsToService: "battery" },
  { id: "s2", emoji: "🛞", label: "Flat tyre / Low pressure", mapsToFilter: "tyre", mapsToService: "tyre" },
  { id: "s3", emoji: "🚚", label: "Engine dead / Accident", mapsToFilter: "towing", mapsToService: "towing" },
  { id: "s4", emoji: "🔑", label: "Keys locked inside", mapsToFilter: "lockout", mapsToService: "lockout" },
  { id: "s5", emoji: "⛽", label: "Out of fuel", mapsToFilter: "fuel", mapsToService: "fuel" },
  { id: "s6", emoji: "⚠️", label: "Engine smoke / Warning light", mapsToFilter: "mechanic", mapsToService: "mechanic" },
];

// ─── SERVICE DATA ─────────────────────────────────────────────────────────────
const TOWING_SERVICES: ServiceItem[] = [
  {
    id: "flatbed_towing",
    service: "towing",
    category: "towing",
    title: "Flatbed Tow Truck",
    price: "₹499",
    rawPrice: 499,
    eta: "8 min",
    badge: "POPULAR",
    badgeColor: "#0C831F",
    description: "Hydraulic tilt-deck for cars, sedans & luxury SUVs",
    whatsIncluded: [
      "Hydraulic tilt-deck loading",
      "First 10 km included in base price",
      "Damage-free tie-down guarantee",
      "Real-time GPS live tracking",
    ],
    distancePricingNote: "Includes first 10 km · ₹15/km after 10 km (GPS tracked)",
    iconName: "car-sport",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
    vehicleType: "four-wheeler",
  },
  {
    id: "bike_towing",
    service: "towing",
    category: "towing",
    title: "2-Wheeler Towing",
    price: "₹299",
    rawPrice: 299,
    eta: "6 min",
    badge: "RAPID",
    badgeColor: "#0C831F",
    description: "Specialized cradle tow truck for motorcycles & scooters",
    whatsIncluded: [
      "Specialized motorcycle wheel cradle",
      "First 10 km included in base price",
      "Four-point soft tie-down straps",
      "Damage-free loading guarantee",
    ],
    distancePricingNote: "Includes first 10 km · ₹10/km after 10 km (GPS tracked)",
    iconName: "bicycle",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
    vehicleType: "two-wheeler",
  },
];

const ROADSIDE_SERVICES: ServiceItem[] = [
  {
    id: "jumpstart_boost",
    service: "battery",
    category: "battery",
    title: "Battery Jumpstart Booster",
    price: "₹249",
    rawPrice: 249,
    eta: "4 min",
    badge: "FASTEST",
    badgeColor: "#C2850C",
    description: "Booster pack jumpstart & alternator health scan",
    whatsIncluded: [
      "Heavy-duty 12V/24V booster pack",
      "Battery voltage & load test",
      "Terminal rust & corrosion cleaning",
      "Alternator health diagnostic report",
    ],
    iconName: "flash",
    iconBg: "#FEF6D8",
    iconColor: "#C2850C",
  },
  {
    id: "flat_tyre_fix",
    service: "tyre",
    category: "tyre",
    title: "Flat Tyre / Puncture Repair",
    price: "₹199",
    rawPrice: 199,
    eta: "5 min",
    badge: "VALUE",
    badgeColor: "#0C831F",
    description: "On-site tubeless puncture repair or stepney wheel swap",
    whatsIncluded: [
      "Tubeless mushroom plug repair",
      "Stepney wheel swap if spare available",
      "High-pressure 12V air inflation",
      "Tyre valve & tread inspection",
    ],
    iconName: "disc",
    iconBg: "#E6F4EA",
    iconColor: "#0C831F",
  },
  {
    id: "emergency_fuel",
    service: "fuel",
    category: "fuel",
    title: "Emergency Fuel Delivery",
    price: "₹149",
    rawPrice: 149,
    eta: "7 min",
    description: "5 Litres of Petrol or Diesel in verified safety Jerrycan",
    whatsIncluded: [
      "5L Petrol or Diesel delivered to spot",
      "PESO-certified anti-spill jerrycan",
      "Fuel billed at local petrol pump MRP",
      "Flat service & delivery dispatch fee",
    ],
    iconName: "water",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
  {
    id: "key_lockout",
    service: "lockout",
    category: "lockout",
    title: "Key Lockout Assist",
    price: "₹299",
    rawPrice: 299,
    eta: "8 min",
    description: "Safe, non-destructive unlocking for keys locked inside",
    whatsIncluded: [
      "Non-destructive air wedge unlocking",
      "Certified automotive locksmith tools",
      "Zero paint or door seal damage guarantee",
      "15-min average on-site resolution",
    ],
    iconName: "key",
    iconBg: "#FEF6D8",
    iconColor: "#C2850C",
  },
  {
    id: "ev_fast_boost",
    service: "battery",
    category: "battery",
    title: "EV Fast Mobile Charge",
    price: "₹349",
    rawPrice: 349,
    eta: "10 min",
    badge: "EV",
    badgeColor: "#0C831F",
    description: "Mobile DC fast boost van providing 15-20 km emergency range",
    whatsIncluded: [
      "15-20 km emergency driving range",
      "High-output mobile DC charge van",
      "Compatible with CCS2 and Type 2 EV ports",
      "Battery thermal & pack diagnostic",
    ],
    iconName: "battery-charging",
    iconBg: "#E6F4EA",
    iconColor: "#0C831F",
    fuelType: "electric",
  },
  {
    id: "mechanic_scan",
    service: "mechanic",
    category: "mechanic",
    title: "On-Spot Mechanic Diagnostic",
    price: "₹399",
    rawPrice: 399,
    eta: "12 min",
    description: "OBD-II computer scan, coolant, belt & minor spot fixes",
    whatsIncluded: [
      "OBD-II computer diagnostic scanning",
      "Coolant leak & fan inspection",
      "Alternator belt & hose inspection",
      "Minor spot repair & driveability check",
    ],
    iconName: "construct",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
];

// ─── FILTER PILLS ─────────────────────────────────────────────────────────────
const FILTER_PILLS: { key: FilterCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All Services", icon: "grid" },
  { key: "towing", label: "Towing", icon: "car-sport" },
  { key: "battery", label: "Battery", icon: "flash" },
  { key: "tyre", label: "Tyre Care", icon: "disc" },
  { key: "fuel", label: "Fuel", icon: "water" },
  { key: "lockout", label: "Lockout", icon: "key" },
  { key: "mechanic", label: "Mechanic", icon: "construct" },
];

export default function ServicesView({
  onLaunchService,
  selectedVehicle,
  onOpenVehicleModal,
  onOpenSos,
  searchQuery = "",
  lastBookedService,
}: ServicesViewProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");
  const [activeSymptom, setActiveSymptom] = useState<string | null>(null);
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [customCouponInput, setCustomCouponInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const query = searchQuery.trim().toLowerCase();

  // Vehicle-aware filtering: hide services incompatible with the selected vehicle
  const isVehicleCompatible = (item: ServiceItem): boolean => {
    if (item.vehicleType && item.vehicleType !== selectedVehicle.type) return false;
    if (item.fuelType === "electric" && selectedVehicle.fuelType !== "electric") return false;
    return true;
  };

  const filterList = (items: ServiceItem[]) => {
    return items.filter((item) => {
      if (!isVehicleCompatible(item)) return false;
      const matchesCategory = activeFilter === "all" || item.category === activeFilter;
      const matchesSearch =
        query === "" ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  };

  const filteredTowing = filterList(TOWING_SERVICES);
  const filteredRoadside = filterList(ROADSIDE_SERVICES);

  // Sort roadside: if vehicle is electric, push EV service to top
  const sortedRoadside = selectedVehicle.fuelType === "electric"
    ? [...filteredRoadside].sort((a, b) => (a.fuelType === "electric" ? -1 : b.fuelType === "electric" ? 1 : 0))
    : filteredRoadside;

  const handleSymptomPress = (chip: SymptomChip) => {
    if (activeSymptom === chip.id) {
      setActiveSymptom(null);
      setActiveFilter("all");
    } else {
      setActiveSymptom(chip.id);
      setActiveFilter(chip.mapsToFilter);
    }
  };

  const handleServiceDetailPress = (item: ServiceItem) => {
    setExpandedServiceId((prev) => (prev === item.id ? null : item.id));
  };

  // Helper to compute discounted price if applicable
  const getServicePrice = (item: ServiceItem) => {
    if (
      appliedCoupon &&
      (!appliedCoupon.applicableCategory || appliedCoupon.applicableCategory === item.category)
    ) {
      const discounted = Math.max(99, item.rawPrice - appliedCoupon.discountAmount);
      return {
        hasDiscount: true,
        discountedPrice: `₹${discounted}`,
        originalPrice: item.price,
      };
    }
    return {
      hasDiscount: false,
      discountedPrice: item.price,
      originalPrice: item.price,
    };
  };

  const handleApplyCoupon = (coupon: Coupon) => {
    setAppliedCoupon(coupon);
    setShowCouponModal(false);
    Alert.alert("Coupon Applied! 🏷️", `${coupon.code} applied successfully! You saved ₹${coupon.discountAmount}.`);
  };

  const handleApplyCustomCoupon = () => {
    const code = customCouponInput.trim().toUpperCase();
    if (!code) return;
    const match = AVAILABLE_COUPONS.find((c) => c.code === code);
    if (match) {
      handleApplyCoupon(match);
      setCustomCouponInput("");
    } else {
      Alert.alert("Invalid Coupon", "Please enter a valid coupon code like FIRST50, JUMP10, or SAHAYAK20.");
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
  };

  // Render a service row (shared between towing & roadside)
  const renderServiceRow = (item: ServiceItem, idx: number, list: ServiceItem[]) => {
    const priceInfo = getServicePrice(item);
    const isExpanded = expandedServiceId === item.id;

    return (
      <View key={item.id}>
        <TouchableOpacity
          style={styles.serviceRow}
          onPress={() => handleServiceDetailPress(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.serviceIconCircle, { backgroundColor: item.iconBg }]}>
            <Ionicons name={item.iconName} size={20} color={item.iconColor} />
          </View>

          <View style={styles.serviceInfoCol}>
            <View style={styles.titleRow}>
              <Text style={styles.serviceTitle}>{item.title}</Text>
              {item.badge && (
                <View style={[styles.badgeTag, { borderColor: item.badgeColor }]}>
                  <Text style={[styles.badgeTagText, { color: item.badgeColor }]}>
                    {item.badge}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.serviceDesc} numberOfLines={1}>
              {item.description}
            </Text>
            <Text style={styles.etaText}>
              <Text style={{ color: "#0C831F", fontWeight: "700" }}>{item.eta}</Text> arrival · Fixed rate
            </Text>
          </View>

          <View style={styles.priceActionCol}>
            <View style={{ alignItems: "flex-end" }}>
              {priceInfo.hasDiscount ? (
                <>
                  <Text style={[styles.priceText, { color: "#0C831F" }]}>
                    {priceInfo.discountedPrice}
                  </Text>
                  <Text style={styles.originalPriceText}>{priceInfo.originalPrice}</Text>
                </>
              ) : (
                <Text style={styles.priceText}>{item.price}</Text>
              )}
            </View>
            <Ionicons
              name={isExpanded ? "chevron-down" : "chevron-forward"}
              size={16}
              color="#94A3B8"
            />
          </View>
        </TouchableOpacity>

        {/* Expanded "What's included" detail (Phase 1 & 2 Feature) */}
        {isExpanded && (
          <View style={styles.expandedDetail}>
            <Text style={styles.expandedTitle}>What's included</Text>
            {item.whatsIncluded.map((incl, i) => (
              <View key={i} style={styles.includedRow}>
                <Ionicons name="checkmark-circle" size={14} color="#0C831F" />
                <Text style={styles.includedText}>{incl}</Text>
              </View>
            ))}

            {item.distancePricingNote && (
              <View style={styles.distanceNoteBox}>
                <Ionicons name="location-outline" size={13} color="#C2850C" />
                <Text style={styles.distanceNoteText}>{item.distancePricingNote}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.bookNowBtn}
              onPress={() => onLaunchService(item.service, item.title)}
              activeOpacity={0.85}
            >
              <Text style={styles.bookNowBtnText}>
                Book Now · {priceInfo.discountedPrice}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {idx < list.length - 1 && <View style={styles.divider} />}
      </View>
    );
  };

  const hasAnyServices = filteredTowing.length > 0 || sortedRoadside.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 1. ACTIVE VEHICLE CARD ── */}
        <View style={styles.sectionMargin}>
          <View style={styles.groupedCard}>
            <TouchableOpacity
              style={styles.vehicleRow}
              onPress={onOpenVehicleModal}
              activeOpacity={0.7}
            >
              <View style={styles.vehicleIconCircle}>
                <Ionicons
                  name={selectedVehicle.type === "two-wheeler" ? "bicycle" : "car-sport"}
                  size={20}
                  color="#1C1C1C"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleTitle}>
                  {selectedVehicle.make} {selectedVehicle.model}
                </Text>
                <Text style={styles.vehicleMeta}>
                  {selectedVehicle.licensePlate} · {selectedVehicle.fuelType?.toUpperCase()}
                </Text>
              </View>
              <View style={styles.changeActionRow}>
                <Text style={styles.changeActionText}>Switch</Text>
                <Ionicons name="chevron-forward" size={15} color="#94A3B8" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. "WHAT HAPPENED?" SYMPTOM PICKER (Phase 1 Feature) ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>What happened?</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.symptomScroll}
        >
          {SYMPTOM_CHIPS.map((chip) => {
            const isActive = activeSymptom === chip.id;
            return (
              <TouchableOpacity
                key={chip.id}
                style={[styles.symptomChip, isActive && styles.symptomChipActive]}
                onPress={() => handleSymptomPress(chip)}
                activeOpacity={0.8}
              >
                <Text style={styles.symptomEmoji}>{chip.emoji}</Text>
                <Text style={[styles.symptomLabel, isActive && styles.symptomLabelActive]}>
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── 3. CATEGORY FILTER PILLS ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersScroll}
        >
          {FILTER_PILLS.map((pill) => {
            const isActive = activeFilter === pill.key;
            return (
              <TouchableOpacity
                key={pill.key}
                style={[styles.filterPill, isActive && styles.filterPillActive]}
                onPress={() => {
                  setActiveFilter(pill.key);
                  setActiveSymptom(null);
                }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={pill.icon}
                  size={14}
                  color={isActive ? "#FFFFFF" : "#5E6470"}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.filterPillText, isActive && styles.filterPillTextActive]}
                >
                  {pill.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── 4. RECENTLY BOOKED SHORTCUT (Phase 1 Feature) ── */}
        {lastBookedService && (
          <View style={styles.sectionMargin}>
            <View style={styles.groupedCard}>
              <TouchableOpacity
                style={styles.recentRow}
                onPress={() => onLaunchService(lastBookedService.type, lastBookedService.title)}
                activeOpacity={0.7}
              >
                <View style={[styles.serviceIconCircle, { backgroundColor: "#FEF6D8" }]}>
                  <Ionicons name="repeat" size={18} color="#C2850C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentTitle}>Rebook: {lastBookedService.title}</Text>
                  <Text style={styles.recentSub}>Quick 1-tap rebook for {lastBookedService.vehicle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 5. PROMO / COUPON CODE BANNER OR TRIGGER ── */}
        <View style={styles.sectionMargin}>
          <View style={styles.groupedCard}>
            {appliedCoupon ? (
              <View style={styles.couponAppliedRow}>
                <View style={[styles.serviceIconCircle, { backgroundColor: "#E6F4EA" }]}>
                  <Ionicons name="checkmark-circle" size={20} color="#0C831F" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.couponAppliedTitle}>
                    Code <Text style={{ fontWeight: "800" }}>{appliedCoupon.code}</Text> Applied
                  </Text>
                  <Text style={styles.couponAppliedSub}>
                    Saving ₹{appliedCoupon.discountAmount} · {appliedCoupon.title}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.removeCouponBtn}
                  onPress={handleRemoveCoupon}
                  activeOpacity={0.7}
                >
                  <Text style={styles.removeCouponText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.serviceRow}
                onPress={() => setShowCouponModal(true)}
                activeOpacity={0.7}
              >
                <View style={[styles.serviceIconCircle, { backgroundColor: "#FEF6D8" }]}>
                  <Ionicons name="pricetag" size={18} color="#C2850C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.serviceTitle}>Apply Coupon / Promo Code</Text>
                  <Text style={styles.serviceDesc}>
                    Save up to ₹100 on towing, jumpstart & rescue
                  </Text>
                </View>
                <View style={styles.changeActionRow}>
                  <Text style={[styles.changeActionText, { color: "#0C831F" }]}>View Offers</Text>
                  <Ionicons name="chevron-forward" size={15} color="#0C831F" />
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── EMPTY STATE IF NO SERVICES MATCH ── */}
        {!hasAnyServices && (
          <View style={styles.sectionMargin}>
            <View style={styles.groupedCard}>
              <View style={styles.emptyStateBox}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="search-outline" size={28} color="#94A3B8" />
                </View>
                <Text style={styles.emptyStateTitle}>No matching services</Text>
                <Text style={styles.emptyStateSub}>
                  No roadside services found for &quot;{query}&quot;.
                </Text>
                <TouchableOpacity
                  style={styles.resetFilterBtn}
                  onPress={() => {
                    setActiveFilter("all");
                    setActiveSymptom(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resetFilterBtnText}>Show All Services</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── 6. GROUPED SECTION: TOWING & RECOVERY ── */}
        {filteredTowing.length > 0 && (
          <View style={styles.sectionMargin}>
            <Text style={styles.sectionGroupTitle}>Towing & recovery</Text>
            <View style={styles.groupedCard}>
              {filteredTowing.map((item, idx) => renderServiceRow(item, idx, filteredTowing))}
            </View>
          </View>
        )}

        {/* ── 7. GROUPED SECTION: ROADSIDE ASSISTANCE & REPAIRS ── */}
        {sortedRoadside.length > 0 && (
          <View style={styles.sectionMargin}>
            <Text style={styles.sectionGroupTitle}>Roadside repairs & assistance</Text>
            <View style={styles.groupedCard}>
              {sortedRoadside.map((item, idx) => renderServiceRow(item, idx, sortedRoadside))}
            </View>
          </View>
        )}

        {/* ── 8. GROUPED SECTION: MEMBERSHIP & PERKS ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Membership & perks</Text>
          <View style={styles.groupedCard}>
            <TouchableOpacity
              style={styles.serviceRow}
              onPress={() => {
                Alert.alert(
                  "Sahayak RSA Pass 🛡️",
                  "Status: ACTIVE\nValid Till: 29 Sep 2027\n\n• Unlimited Free Towing (up to 50 km)\n• Free Battery Jumpstarts\n• Free Puncture Repairs\n• Zero Platform Fees"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: "#E6F4EA" }]}>
                <Ionicons name="shield-checkmark" size={20} color="#0C831F" />
              </View>

              <View style={styles.serviceInfoCol}>
                <View style={styles.titleRow}>
                  <Text style={styles.serviceTitle}>Sahayak RSA Annual Pass</Text>
                  <View style={styles.activePassBadge}>
                    <Text style={styles.activePassBadgeText}>ACTIVE</Text>
                  </View>
                </View>
                <Text style={styles.serviceDesc} numberOfLines={1}>
                  Unlimited free towing up to 50 km & battery boosts
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.serviceRow}
              onPress={() => {
                Alert.alert(
                  "Sahayak Cash",
                  "Available Balance: ₹450\n\nInstant cashless breakdown dispatch with zero platform fees."
                );
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: "#FEF6D8" }]}>
                <Ionicons name="wallet-outline" size={20} color="#1C1C1C" />
              </View>

              <View style={styles.serviceInfoCol}>
                <Text style={styles.serviceTitle}>Sahayak Cash Balance</Text>
                <Text style={styles.serviceDesc}>₹450 available for instant dispatch</Text>
              </View>

              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 9. GROUPED SECTION: SERVICE GUARANTEES ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Service guarantees</Text>
          <View style={styles.groupedCard}>
            <View style={styles.guaranteeRowItem}>
              <View style={[styles.serviceIconCircle, { backgroundColor: "#E6F4EA" }]}>
                <Ionicons name="speedometer-outline" size={20} color="#0C831F" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guaranteeTitle}>15-Minute Guaranteed Arrival</Text>
                <Text style={styles.guaranteeSub}>Live GPS tracking and nearest mechanic dispatch</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.guaranteeRowItem}>
              <View style={[styles.serviceIconCircle, { backgroundColor: "#F0F2F5" }]}>
                <Ionicons name="pricetag-outline" size={20} color="#1C1C1C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guaranteeTitle}>Standardized Fixed Rates</Text>
                <Text style={styles.guaranteeSub}>Zero roadside surge or unexpected pricing</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.guaranteeRowItem}>
              <View style={[styles.serviceIconCircle, { backgroundColor: "#FEF6D8" }]}>
                <Ionicons name="ribbon-outline" size={20} color="#C2850C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guaranteeTitle}>100% Verified Technicians</Text>
                <Text style={styles.guaranteeSub}>Background-checked mechanics & verified towing fleet</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── COUPON OFFERS MODAL ── */}
      <Modal
        visible={showCouponModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCouponModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.couponModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Available Coupons</Text>
              <TouchableOpacity
                onPress={() => setShowCouponModal(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            {/* Custom Input */}
            <View style={styles.couponInputRow}>
              <TextInput
                style={styles.couponTextInput}
                placeholder="Enter coupon code (e.g. FIRST50)"
                placeholderTextColor="#94A3B8"
                value={customCouponInput}
                onChangeText={setCustomCouponInput}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.applyInputBtn, !customCouponInput.trim() && { opacity: 0.5 }]}
                onPress={handleApplyCustomCoupon}
                disabled={!customCouponInput.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.applyInputBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>

            {/* Available Coupon List */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {AVAILABLE_COUPONS.map((coupon) => (
                <View key={coupon.code} style={styles.couponItemCard}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.couponCodeBadge}>
                      <Text style={styles.couponCodeText}>{coupon.code}</Text>
                    </View>
                    <Text style={styles.couponTitle}>{coupon.title}</Text>
                    <Text style={styles.couponDesc}>{coupon.discountDesc}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.couponApplyBtn}
                    onPress={() => handleApplyCoupon(coupon)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.couponApplyBtnText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── STYLES (AccountView Grouped-Card Standard — No Boxes) ─────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
    paddingTop: 12,
  },
  sectionMargin: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionGroupTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "700",
    color: "#5E6470",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupedCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#EAECEF",
  },

  // 1. Vehicle Selector Row
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  vehicleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F0F2F5",
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  vehicleMeta: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    color: "#5E6470",
    marginTop: 2,
  },
  changeActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  changeActionText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#94A3B8",
  },

  // 2. Symptom Picker Chips
  symptomScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
  },
  symptomChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EAECEF",
    gap: 6,
  },
  symptomChipActive: {
    backgroundColor: "#FEF6D8",
    borderColor: "#F8CB46",
  },
  symptomEmoji: {
    fontSize: 14,
  },
  symptomLabel: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  symptomLabelActive: {
    color: "#8F6405",
    fontWeight: "700",
  },

  // 3. Filter Pills
  filtersScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 14,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#E2E8F0",
  },
  filterPillActive: {
    backgroundColor: "#1C1C1C",
  },
  filterPillText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#5E6470",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // 4. Recently Booked Shortcut
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  recentTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  recentSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },

  // Coupon Rows
  couponAppliedRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    backgroundColor: "#F0FDF4",
  },
  couponAppliedTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    color: "#166534",
  },
  couponAppliedSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#15803D",
    marginTop: 1,
  },
  removeCouponBtn: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DCFCE7",
  },
  removeCouponText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    color: "#DC2626",
  },

  // 5. Service Rows
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  serviceIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceInfoCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  serviceTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  badgeTag: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeTagText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
  },
  serviceDesc: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  etaText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#8C93A3",
    marginTop: 2,
  },
  priceActionCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  priceText: {
    fontSize: 14.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  originalPriceText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    color: "#94A3B8",
    textDecorationLine: "line-through",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginLeft: 68,
  },

  // Expanded Detail
  expandedDetail: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingLeft: 68,
  },
  expandedTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    marginBottom: 6,
  },
  includedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  includedText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
  },
  distanceNoteBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginTop: 8,
  },
  distanceNoteText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    color: "#8F6405",
  },
  bookNowBtn: {
    backgroundColor: "#1C1C1C",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  bookNowBtnText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Empty State
  emptyStateBox: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyStateTitle: {
    fontSize: 14.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  emptyStateSub: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    textAlign: "center",
    marginTop: 3,
  },
  resetFilterBtn: {
    marginTop: 14,
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  resetFilterBtnText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Active RSA Pass Badge
  activePassBadge: {
    backgroundColor: "#E6F4EA",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  activePassBadgeText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#0C831F",
  },

  // Guarantee Row Items
  guaranteeRowItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 14,
  },
  guaranteeTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  guaranteeSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  couponModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  couponInputRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  couponTextInput: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
  },
  applyInputBtn: {
    backgroundColor: "#1C1C1C",
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  applyInputBtnText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  couponItemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  couponCodeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#F8CB46",
    marginBottom: 4,
  },
  couponCodeText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#8F6405",
    letterSpacing: 1,
  },
  couponTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  couponDesc: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
  },
  couponApplyBtn: {
    backgroundColor: "#0C831F",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 10,
  },
  couponApplyBtnText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
