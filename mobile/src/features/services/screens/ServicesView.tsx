// ─── Sahayak — Services Screen (Blinkit Exact Theme & Spacing) ────────────────
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
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
  badgeType?: "success" | "warning" | "info";
  description: string;
  image: any;
  featured?: boolean;
}

const SERVICES_CATALOG: ServiceItem[] = [
  {
    id: "flatbed_towing",
    service: "towing",
    category: "towing",
    title: "Flatbed Tow Truck",
    price: "₹499",
    eta: "8 min",
    badge: "MOST POPULAR",
    badgeType: "success",
    description: "Hydraulic tilt-deck for cars, sedans & luxury SUVs",
    image: require("../../../../assets/minutes/hero_rescue_clean.png"),
    featured: true,
  },
  {
    id: "bike_towing",
    service: "towing",
    category: "towing",
    title: "2-Wheeler Towing",
    price: "₹299",
    eta: "6 min",
    badge: "RAPID DISPATCH",
    badgeType: "info",
    description: "Specialized cradle tow truck for motorcycles & scooters",
    image: require("../../../../assets/for_you/bike.png"),
  },
  {
    id: "jumpstart_boost",
    service: "battery",
    category: "battery",
    title: "Battery Jumpstart",
    price: "₹249",
    eta: "4 min",
    badge: "FASTEST ARRIVAL",
    badgeType: "warning",
    description: "Heavy-duty booster pack & battery alternator health test",
    image: require("../../../../assets/minutes/jumpstart.png"),
  },
  {
    id: "flat_tyre_fix",
    service: "tyre",
    category: "tyre",
    title: "Flat Tyre / Puncture",
    price: "₹199",
    eta: "5 min",
    badge: "BEST VALUE",
    badgeType: "success",
    description: "On-site tubeless puncture repair or stepney wheel swap",
    image: require("../../../../assets/minutes/flat_tyre.png"),
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
  },
  {
    id: "ev_fast_boost",
    service: "battery",
    category: "battery",
    title: "EV Fast Mobile Charge",
    price: "₹349",
    eta: "10 min",
    badge: "EV RESCUE",
    badgeType: "success",
    description: "Mobile DC fast boost van providing 15-20 km emergency range",
    image: require("../../../../assets/for_you/ev_boost.png"),
  },
  {
    id: "engine_diagnostics",
    service: "mechanic",
    category: "mechanic",
    title: "On-Site Mechanic Scan",
    price: "₹399",
    eta: "12 min",
    badge: "CERTIFIED",
    badgeType: "info",
    description: "OBD-II scanner diagnosis & instant minor roadside fix",
    image: require("../../../../assets/for_you/mechanic.png"),
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
        {/* ── 1. ACTIVE VEHICLE SELECTOR CARD (BLINKIT STYLE) ── */}
        <TouchableOpacity
          style={styles.vehicleCard}
          onPress={onOpenVehicleModal}
          activeOpacity={0.85}
        >
          <View style={styles.vehicleCardLeft}>
            <View style={styles.vehicleIconCircle}>
              <Ionicons
                name={selectedVehicle.type === "two-wheeler" ? "bicycle" : "car"}
                size={20}
                color="#1C1C1C"
              />
            </View>
            <View>
              <Text style={styles.vehicleTitle}>
                {selectedVehicle.make} {selectedVehicle.model}
              </Text>
              <Text style={styles.vehicleMeta}>
                {selectedVehicle.licensePlate} · {selectedVehicle.fuelType?.toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.switchPill}>
            <Text style={styles.switchPillText}>Switch ▾</Text>
          </View>
        </TouchableOpacity>

        {/* ── 2. CATEGORY FILTER PILLS ── */}
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

        {/* ── 5. SERVICES SECTION HEADING ── */}
        <Text style={styles.sectionHeading}>
          {activeFilter === "all" ? "Emergency breakdown services" : "Matching services"}
        </Text>

        {/* ── 6. SERVICES CARDS LIST (CLEAN WHITE 16PX RADIUS BLINKIT CARDS) ── */}
        <View style={styles.servicesList}>
          {filteredServices.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.serviceCard}
              onPress={() => onLaunchService(item.service, item.title)}
              activeOpacity={0.85}
            >
              <View style={styles.cardMainRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  {item.badge && (
                    <View
                      style={[
                        styles.cardBadge,
                        item.badgeType === "warning"
                          ? styles.badgeWarning
                          : item.badgeType === "info"
                          ? styles.badgeInfo
                          : styles.badgeSuccess,
                      ]}
                    >
                      <Text
                        style={[
                          styles.cardBadgeText,
                          item.badgeType === "warning"
                            ? styles.badgeTextWarning
                            : item.badgeType === "info"
                            ? styles.badgeTextInfo
                            : styles.badgeTextSuccess,
                        ]}
                      >
                        {item.badge}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                </View>

                <View style={styles.cardImageWrapper}>
                  <Image
                    source={item.image}
                    style={styles.cardImage}
                    resizeMode="contain"
                  />
                </View>
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardBottomRow}>
                <View style={styles.pricePill}>
                  <Text style={styles.priceText}>{item.price}</Text>
                </View>

                <View style={styles.etaBox}>
                  <Ionicons name="time-outline" size={13} color="#0C831F" />
                  <Text style={styles.etaText}>{item.eta} arrival</Text>
                </View>

                <View style={styles.bookActionPill}>
                  <Text style={styles.bookActionText}>Book Now</Text>
                  <Ionicons name="chevron-forward" size={12} color="#1C1C1C" />
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 7. SAHAYAK RSA PASS PROMO CARD (BLINKIT PASS THEME) ── */}
        <TouchableOpacity
          style={styles.rsaPassCard}
          onPress={() => {
            Alert.alert(
              "Sahayak RSA Pass 🛡️",
              "Unlimited free towing up to 50 km, battery jumpstarts, flat tyre repair, and zero emergency platform fee.\n\nOnly ₹99/month. Billed annually or monthly."
            );
          }}
          activeOpacity={0.9}
        >
          <View style={styles.rsaPassContent}>
            <View style={styles.rsaPassBadge}>
              <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
              <Text style={styles.rsaPassBadgeText}>ANNUAL PASS · ₹99/MO</Text>
            </View>
            <Text style={styles.rsaPassTitle}>Unlimited Roadside Rescue</Text>
            <Text style={styles.rsaPassSub}>
              Zero towing charges up to 50 km, free battery boost & tyre repair 24/7 across India.
            </Text>
            <View style={styles.rsaPassBtn}>
              <Text style={styles.rsaPassBtnText}>Activate RSA Pass ›</Text>
            </View>
          </View>

          <Image
            source={require("../../../../assets/for_you/rsa_pass.png")}
            style={styles.rsaPassImage}
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* ── 8. THREE TRUST GUARANTEES (ACCOUNT 3-CARD ROW MATCH) ── */}
        <View style={styles.guaranteeRow}>
          <View style={styles.guaranteeCard}>
            <View style={[styles.guaranteeIconCircle, { backgroundColor: "#E6F4EA" }]}>
              <Ionicons name="speedometer-outline" size={20} color="#0C831F" />
            </View>
            <Text style={styles.guaranteeTitle}>15-Min ETA</Text>
            <Text style={styles.guaranteeSub}>Live GPS fleet</Text>
          </View>

          <View style={styles.guaranteeCard}>
            <View style={[styles.guaranteeIconCircle, { backgroundColor: "#F0F0F0" }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#1C1C1C" />
            </View>
            <Text style={styles.guaranteeTitle}>Fixed Rates</Text>
            <Text style={styles.guaranteeSub}>No roadside surge</Text>
          </View>

          <View style={styles.guaranteeCard}>
            <View style={[styles.guaranteeIconCircle, { backgroundColor: "#FEF6D8" }]}>
              <Ionicons name="ribbon-outline" size={20} color="#E5B933" />
            </View>
            <Text style={styles.guaranteeTitle}>Verified Pros</Text>
            <Text style={styles.guaranteeSub}>Certified mechanics</Text>
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 100,
  },

  // 1. Header Row
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
    marginTop: 3,
  },
  sosButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E23744",
    gap: 4,
    elevation: 2,
  },
  sosButtonText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    color: "#E23744",
    letterSpacing: 0.5,
  },

  // 2. Active Vehicle Selector Card
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    marginBottom: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  vehicleCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  vehicleIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F5F6F8",
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
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#5E6470",
    marginTop: 2,
  },
  switchPill: {
    backgroundColor: "#F5F6F8",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFF1F5",
  },
  switchPillText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  // 3. Search Bar
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#1C1C1C",
    padding: 0,
  },

  // 4. Filters Horizontal Scroll
  filtersScroll: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 16,
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
    gap: 6,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  filterPillActive: {
    backgroundColor: "#1C1C1C",
    borderColor: "#1C1C1C",
  },
  filterPillText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#5E6470",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
  },

  // 5. Section Heading
  sectionHeading: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.2,
    marginBottom: 10,
  },

  // 6. Services Cards List
  servicesList: {
    gap: 10,
  },
  serviceCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    padding: 14,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  cardMainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    marginBottom: 6,
  },
  badgeSuccess: {
    backgroundColor: "#E6F4EA",
  },
  badgeWarning: {
    backgroundColor: "#FEF6D8",
  },
  badgeInfo: {
    backgroundColor: "#F0F0F0",
  },
  cardBadgeText: {
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  badgeTextSuccess: {
    color: "#0C831F",
  },
  badgeTextWarning: {
    color: "#1C1C1C",
  },
  badgeTextInfo: {
    color: "#1C1C1C",
  },
  cardTitle: {
    fontSize: 15.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    lineHeight: 16,
  },
  cardImageWrapper: {
    width: 68,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  cardImage: {
    width: 64,
    height: 52,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginVertical: 10,
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pricePill: {
    backgroundColor: "#F5F6F8",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priceText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  etaBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  etaText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#0C831F",
  },
  bookActionPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F6F8",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EFF1F5",
    gap: 3,
  },
  bookActionText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },

  // 7. Sahayak RSA Pass Promo Card
  rsaPassCard: {
    marginTop: 18,
    backgroundColor: "#0C831F",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  rsaPassContent: {
    flex: 1,
    paddingRight: 10,
  },
  rsaPassBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    alignSelf: "flex-start",
    gap: 4,
    marginBottom: 8,
  },
  rsaPassBadgeText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.4,
  },
  rsaPassTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  rsaPassSub: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 4,
    lineHeight: 16,
  },
  rsaPassBtn: {
    marginTop: 12,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  rsaPassBtnText: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
  },
  rsaPassImage: {
    width: 76,
    height: 76,
  },

  // 8. Guarantees 3-Card Row
  guaranteeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  guaranteeCard: {
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
  guaranteeIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  guaranteeTitle: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    textAlign: "center",
  },
  guaranteeSub: {
    fontSize: 10.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
    textAlign: "center",
  },
});
