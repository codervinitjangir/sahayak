// ─── Sahayak — Services Screen ────────────────────────────────────────────────
// Redesigned with the clean, flat grouped-card design language of AccountView.
// Replaces AI slopes, slanted boxes, and conflicting badges with structured, unified cards.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
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
}

type FilterCategory = "all" | "towing" | "battery" | "tyre" | "fuel" | "lockout" | "mechanic";

interface ServiceItem {
  id: string;
  service: ServiceType;
  title: string;
  category: FilterCategory;
  price: string;
  eta: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  image: any;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
}

const SERVICES_CATALOG: ServiceItem[] = [
  {
    id: "flatbed_towing",
    service: "towing",
    category: "towing",
    title: "Flatbed Tow Truck",
    price: "₹499",
    eta: "8 min",
    badge: "POPULAR",
    badgeColor: "#0C831F",
    description: "Hydraulic tilt-deck for cars, sedans & luxury SUVs",
    image: require("../../../../assets/minutes/hero_rescue_clean.png"),
    iconName: "car-sport",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
  {
    id: "bike_towing",
    service: "towing",
    category: "towing",
    title: "2-Wheeler Towing",
    price: "₹299",
    eta: "6 min",
    badge: "FAST",
    badgeColor: "#0C831F",
    description: "Specialized cradle tow truck for motorcycles & scooters",
    image: require("../../../../assets/for_you/bike.png"),
    iconName: "bicycle",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
  {
    id: "jumpstart_boost",
    service: "battery",
    category: "battery",
    title: "Battery Jumpstart",
    price: "₹249",
    eta: "4 min",
    badge: "FASTEST",
    badgeColor: "#C2850C",
    description: "Heavy-duty booster pack & alternator health test",
    image: require("../../../../assets/minutes/jumpstart.png"),
    iconName: "flash",
    iconBg: "#FEF6D8",
    iconColor: "#C2850C",
  },
  {
    id: "flat_tyre_fix",
    service: "tyre",
    category: "tyre",
    title: "Flat Tyre / Puncture",
    price: "₹199",
    eta: "5 min",
    badge: "VALUE",
    badgeColor: "#0C831F",
    description: "On-site tubeless puncture repair or stepney wheel swap",
    image: require("../../../../assets/minutes/flat_tyre.png"),
    iconName: "disc",
    iconBg: "#E6F4EA",
    iconColor: "#0C831F",
  },
  {
    id: "emergency_fuel",
    service: "fuel",
    category: "fuel",
    title: "Emergency Fuel",
    price: "₹149",
    eta: "7 min",
    description: "5 Litres of Petrol or Diesel delivered in safe Jerrycan",
    image: require("../../../../assets/for_you/fuel.png"),
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
    eta: "8 min",
    description: "Safe, non-destructive unlocking for keys locked inside",
    image: require("../../../../assets/for_you/lockout.png"),
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
    eta: "10 min",
    badge: "EV RESCUE",
    badgeColor: "#0C831F",
    description: "Mobile DC fast boost van providing 15-20 km range",
    image: require("../../../../assets/for_you/ev_boost.png"),
    iconName: "battery-charging",
    iconBg: "#E6F4EA",
    iconColor: "#0C831F",
  },
  {
    id: "engine_diagnostics",
    service: "mechanic",
    category: "mechanic",
    title: "On-Site Mechanic Scan",
    price: "₹399",
    eta: "12 min",
    badge: "CERTIFIED",
    badgeColor: "#1C1C1C",
    description: "OBD-II scanner diagnosis & instant minor roadside fix",
    image: require("../../../../assets/for_you/mechanic.png"),
    iconName: "construct",
    iconBg: "#F0F2F5",
    iconColor: "#1C1C1C",
  },
];

const FILTER_PILLS: { key: FilterCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All Services", icon: "apps" },
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
}: ServicesViewProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");

  const query = searchQuery.trim().toLowerCase();
  const filteredServices = SERVICES_CATALOG.filter((item) => {
    const matchesCategory = activeFilter === "all" || item.category === activeFilter;
    const matchesSearch =
      query === "" ||
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 1. ACTIVE VEHICLE SELECTOR CARD (MATCHING ACCOUNT VIEW VEHICLE SELECT CARD) ── */}
        <TouchableOpacity
          style={styles.vehicleCard}
          onPress={onOpenVehicleModal}
          activeOpacity={0.8}
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
          <View style={styles.switchButton}>
            <Text style={styles.switchButtonText}>Change</Text>
            <Ionicons name="chevron-forward" size={14} color="#64748B" />
          </View>
        </TouchableOpacity>

        {/* ── 2. CATEGORY FILTER PILLS (CLEAN, FLAT, NO DIAGONAL SLOPES) ── */}
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
                onPress={() => setActiveFilter(pill.key)}
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

        {/* ── 3. SERVICES CATALOG (GROUPED WHITE CARDS MATCHING ACCOUNT VIEW) ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>
            {activeFilter === "all" ? "Available breakdown services" : `${activeFilter.toUpperCase()} services`}
          </Text>

          <View style={styles.groupedCard}>
            {filteredServices.map((item, idx) => (
              <View key={item.id}>
                <TouchableOpacity
                  style={styles.serviceRow}
                  onPress={() => onLaunchService(item.service, item.title)}
                  activeOpacity={0.7}
                >
                  {/* Clean Icon Box */}
                  <View style={[styles.serviceIconBox, { backgroundColor: item.iconBg }]}>
                    <Ionicons name={item.iconName} size={22} color={item.iconColor} />
                  </View>

                  {/* Main Details */}
                  <View style={styles.serviceContent}>
                    <View style={styles.titleRow}>
                      <Text style={styles.serviceName}>{item.title}</Text>
                      {item.badge && (
                        <View style={[styles.cleanBadge, { borderColor: item.badgeColor }]}>
                          <Text style={[styles.cleanBadgeText, { color: item.badgeColor }]}>
                            {item.badge}
                          </Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.serviceDesc} numberOfLines={1}>
                      {item.description}
                    </Text>

                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={12} color="#0C831F" />
                      <Text style={styles.etaText}>{item.eta} arrival</Text>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.guaranteeTag}>Fixed price</Text>
                    </View>
                  </View>

                  {/* Price & Book Button */}
                  <View style={styles.serviceRight}>
                    <Text style={styles.priceText}>{item.price}</Text>
                    <View style={styles.bookPill}>
                      <Text style={styles.bookPillText}>Book</Text>
                      <Ionicons name="chevron-forward" size={12} color="#1C1C1C" />
                    </View>
                  </View>
                </TouchableOpacity>

                {idx < filteredServices.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        </View>

        {/* ── 4. SAHAYAK RSA PASS CARD (MATCHING ACCOUNT TOGGLE CARD PATTERN) ── */}
        <View style={styles.sectionMargin}>
          <TouchableOpacity
            style={styles.rsaPassCard}
            onPress={() => {
              Alert.alert(
                "Sahayak RSA Pass 🛡️",
                "Unlimited free towing up to 50 km, battery jumpstarts, flat tyre repair, and zero emergency platform fee.\n\nOnly ₹99/month. Billed annually or monthly."
              );
            }}
            activeOpacity={0.85}
          >
            <View style={styles.rsaIconCircle}>
              <Ionicons name="shield-checkmark" size={22} color="#0C831F" />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.rsaHeaderRow}>
                <Text style={styles.rsaTitle}>Sahayak RSA Pass</Text>
                <View style={styles.passTag}>
                  <Text style={styles.passTagText}>₹99/MO</Text>
                </View>
              </View>
              <Text style={styles.rsaSub}>
                Zero towing charges up to 50 km, free battery boost & tyre puncture repair across India.
              </Text>
              <Text style={styles.knowMoreLink}>Activate Annual Pass ›</Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* ── 5. THREE TRUST GUARANTEES (EXACT MATCH TO ACCOUNT 3-CARD ROW) ── */}
        <View style={styles.cardsRowWrapper}>
          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="speedometer-outline" size={24} color="#0C831F" />
            </View>
            <Text style={styles.threeCardTitle}>15-Min ETA</Text>
            <Text style={styles.threeCardSub}>Live GPS fleet</Text>
          </View>

          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="shield-checkmark-outline" size={24} color="#1C1C1C" />
            </View>
            <Text style={styles.threeCardTitle}>Fixed Rates</Text>
            <Text style={styles.threeCardSub}>Zero surge</Text>
          </View>

          <View style={styles.threeCardItem}>
            <View style={styles.threeCardIconBox}>
              <Ionicons name="ribbon-outline" size={24} color="#C2850C" />
            </View>
            <Text style={styles.threeCardTitle}>Verified Pros</Text>
            <Text style={styles.threeCardSub}>Certified teams</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#F5F6F8",
  },
  scrollContent: {
    paddingBottom: 110,
  },

  // 1. Active Vehicle Selector Card (Account View Match)
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    gap: 12,
  },
  vehicleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEF6D8",
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
  switchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  switchButtonText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },

  // 2. Filter Pills
  filtersScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFF1F5",
  },
  filterPillActive: {
    backgroundColor: "#1C1C1C",
    borderColor: "#1C1C1C",
  },
  filterPillText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // Section Margins
  sectionMargin: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  sectionGroupTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    marginBottom: 8,
    letterSpacing: -0.2,
  },

  // 3. Grouped Card & Service Rows (Account View Match)
  groupedCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    overflow: "hidden",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  serviceIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  serviceContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  serviceName: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  cleanBadge: {
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cleanBadgeText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  serviceDesc: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  etaText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
  },
  bulletDot: {
    fontSize: 10,
    color: "#94A3B8",
  },
  guaranteeTag: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.medium,
    color: "#64748B",
  },
  serviceRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  priceText: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  bookPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F6F8",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 2,
  },
  bookPillText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginLeft: 68,
  },

  // 4. RSA Pass Card (Account Toggle Card Match)
  rsaPassCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    gap: 12,
  },
  rsaIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
  },
  rsaHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rsaTitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  passTag: {
    backgroundColor: "#FEF6D8",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  passTagText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  rsaSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 3,
    lineHeight: 16,
  },
  knowMoreLink: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
    marginTop: 5,
  },

  // 5. Three Trust Cards (Exact Account View threeCardItem Match)
  cardsRowWrapper: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 16,
  },
  threeCardItem: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  threeCardIconBox: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  threeCardTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    textAlign: "center",
  },
  threeCardSub: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 1,
    textAlign: "center",
  },
});
