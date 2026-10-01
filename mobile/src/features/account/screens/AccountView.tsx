// ─── Sahayak — Account Screen (Blinkit Exact Match & Dynamic Scroll) ───────────────────────
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Dimensions,
  Share,
  Platform,
  StatusBar,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "../../../constants/theme";
import { useAuthStore } from "../../../store/authStore";
import type { Vehicle } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface AccountViewProps {
  selectedVehicle?: Vehicle;
  onSelectVehicle?: (v: Vehicle) => void;
  onOpenVehicleModal?: () => void;
  onOpenSos?: () => void;
  onGoToTab?: (tab: "home" | "services" | "activity" | "account") => void;
  onScrollStateChange?: (scrolled: boolean) => void;
}

export default function AccountView({
  selectedVehicle,
  onSelectVehicle,
  onOpenVehicleModal,
  onOpenSos,
  onGoToTab,
  onScrollStateChange,
}: AccountViewProps) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const [sosBroadcastEnabled, setSosBroadcastEnabled] = useState(false);
  const [appearanceMode, setAppearanceMode] = useState<"LIGHT" | "DARK" | "SYSTEM">("LIGHT");
  const [isScrolled, setIsScrolled] = useState(false);

  // Status bar offset calculation for pure edge-to-edge
  const topInset = insets.top > 0 ? insets.top : Platform.OS === "android" ? (StatusBar.currentHeight ?? 32) : 44;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const scrolled = offsetY > 60;
    if (scrolled !== isScrolled) {
      setIsScrolled(scrolled);
      onScrollStateChange?.(scrolled);
    }
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out of Sahayak?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  };

  const handleShareApp = async () => {
    try {
      await Share.share({
        message:
          "Sahayak 🇮🇳 — 24/7 Roadside Assistance & Breakdown Rescue app. Download: https://sahayak.app/download",
      });
    } catch {
      // Ignored
    }
  };

  const handleAppearanceToggle = () => {
    Alert.alert(
      "Appearance",
      "Select your preferred app theme",
      [
        { text: "LIGHT", onPress: () => setAppearanceMode("LIGHT") },
        { text: "DARK (Coming Soon)", onPress: () => {} },
        { text: "SYSTEM DEFAULT", onPress: () => setAppearanceMode("SYSTEM") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const displayPhone = user?.phone
    ? user.phone.replace("+91", "").trim()
    : "7355614478";

  return (
    <View style={styles.container}>
      {/* Dynamic Status Bar: Translucent yellow when at top, normal #F5F6F8 when scrolled */}
      <StatusBar
        barStyle="dark-content"
        backgroundColor={isScrolled ? "#F5F6F8" : "#F8CB46"}
        translucent
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={true}
      >
        {/* ── 1. FRAME 1: TOP HERO SECTION WITH SEAMLESS GRADIENT THAT EXTENDS TO PHONE TOP ── */}
        <View style={styles.heroOuterWrapper}>
          {/* Linear gradient covering the status bar and fading smoothly behind the 3 cards */}
          <LinearGradient
            colors={["#F8CB46", "#FDE068", "#FDE068", "#FEF6D8", "#F5F6F8"]}
            locations={[0, 0.35, 0.65, 0.88, 1]}
            style={[styles.heroGradient, { paddingTop: topInset + 10 }]}
          >
            {/* Top row with Back Button */}
            <View style={styles.accountTopBarRow}>
              <TouchableOpacity
                style={styles.backCircleBtn}
                onPress={() => onGoToTab?.("home")}
                activeOpacity={0.8}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="arrow-back" size={20} color="#1C1C1C" />
              </TouchableOpacity>
            </View>

            {/* Circular Profile Avatar (Blinkit Exact - Positioned with generous breathing room below back button) */}
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={46} color="#1C1C1C" />
            </View>

            {/* Title & Phone Number - Exact vertical positioning */}
            <Text style={styles.yourAccountTitle}>Your account</Text>
            <Text style={styles.userPhoneText}>{displayPhone}</Text>
          </LinearGradient>
        </View>

        {/* ── 2. FRAME 2: THREE QUICK ACTION PILL CARDS (EXACT MATCH) ── */}
        <View style={styles.cardsRowWrapper}>
          {/* Card 1: Your rescues */}
          <TouchableOpacity
            style={styles.threeCardItem}
            onPress={() => onGoToTab?.("activity")}
            activeOpacity={0.85}
          >
            <View style={styles.threeCardIconBox}>
              <Ionicons name="construct-outline" size={26} color="#1C1C1C" />
            </View>
            <Text style={styles.threeCardTitle}>Your rescues</Text>
          </TouchableOpacity>

          {/* Card 2: Sahayak Cash */}
          <TouchableOpacity
            style={styles.threeCardItem}
            onPress={() => {
              Alert.alert(
                "Sahayak Cash",
                "Available Balance: ₹450\n\nInstant payment for towing, jumpstart, and flat tyres with zero platform fee."
              );
            }}
            activeOpacity={0.85}
          >
            <View style={styles.threeCardIconBox}>
              <View style={styles.walletRupeeBadge}>
                <Ionicons name="wallet-outline" size={26} color="#1C1C1C" />
                <View style={styles.rupeePill}>
                  <Text style={styles.rupeePillText}>₹</Text>
                </View>
              </View>
            </View>
            <Text style={styles.threeCardTitle}>Sahayak Cash</Text>
          </TouchableOpacity>

          {/* Card 3: Need help? */}
          <TouchableOpacity
            style={styles.threeCardItem}
            onPress={() => {
              Alert.alert(
                "Need help? 24/7 Helpline",
                "Sahayak Roadside Emergency Desk\n\nToll-Free: 1800-SAHAYAK (1800-724-2925)\nWhatsApp: +91 80 4921 5500\n\nVerified technicians & towing fleet on standby across India."
              );
            }}
            activeOpacity={0.85}
          >
            <View style={styles.threeCardIconBox}>
              <Ionicons name="chatbubbles-outline" size={26} color="#1C1C1C" />
            </View>
            <Text style={styles.threeCardTitle}>Need help?</Text>
          </TouchableOpacity>
        </View>

        {/* ── 3. FRAME 3: APPEARANCE BAR CARD ── */}
        <View style={styles.sectionMargin}>
          <TouchableOpacity
            style={styles.appearanceCard}
            onPress={handleAppearanceToggle}
            activeOpacity={0.8}
          >
            <View style={styles.appearanceLeft}>
              <Ionicons name="sunny-outline" size={18} color="#1C1C1C" />
              <Text style={styles.appearanceLabel}>Appearance</Text>
            </View>

            <View style={styles.appearanceRight}>
              <Text style={styles.appearanceModeText}>{appearanceMode}</Text>
              <Ionicons name="chevron-down" size={13} color="#64748B" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── 4. FRAME 4: SAFETY / SOS BROADCAST TOGGLE (MATCHING "HIDE SENSITIVE ITEMS") ── */}
        <View style={styles.sectionMargin}>
          <View style={styles.toggleCard}>
            <View style={styles.toggleIconCircle}>
              <Ionicons name="shield-checkmark" size={18} color="#0C831F" />
            </View>

            <View style={styles.toggleContent}>
              <Text style={styles.toggleTitle}>Auto-share live GPS on SOS</Text>
              <Text style={styles.toggleSub}>
                Emergency contacts will receive SMS tracking link during vehicle breakdown
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    "Emergency GPS Broadcast",
                    "When SOS is triggered, an SMS with your live breakdown GPS coordinates is automatically sent to your registered emergency family contacts."
                  );
                }}
              >
                <Text style={styles.knowMoreLink}>Know more</Text>
              </TouchableOpacity>
            </View>

            <Switch
              value={sosBroadcastEnabled}
              onValueChange={setSosBroadcastEnabled}
              trackColor={{ false: "#CBD5E1", true: "#A8D8B4" }}
              thumbColor={sosBroadcastEnabled ? "#0C831F" : "#FFFFFF"}
            />
          </View>
        </View>

        {/* ── 5. FRAME 5: "YOUR INFORMATION" GROUPED SECTION ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Your information</Text>
          <View style={styles.groupedCard}>
            {/* Address book */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Address book",
                  "Saved Locations:\n\n• Home: Indiranagar 100ft Rd, Bengaluru\n• Office: PST Tech Park, Brookefield"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="book-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Address book</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* My vehicles */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={onOpenVehicleModal}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="car-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>My vehicles</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Emergency contacts */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Emergency Contacts",
                  "Registered Contacts:\n\n1. Pooja Sharma: +91 98765 00001\n2. Vikas Sharma: +91 98765 00002"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="people-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Emergency contacts</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* GST details */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "GST Details",
                  "Registered GSTIN: 29AABCS1429B1Z8\nCompany: Sharma Mobility Pvt Ltd"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="receipt-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>GST details</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Sahayak RSA Pass */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Sahayak RSA Pass 🛡️",
                  "Status: ACTIVE\nValid Till: 29 Sep 2027\n\n• Unlimited Free Towing (up to 50km)\n• Free Battery Jumpstarts\n• Free Puncture Repairs"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="shield-checkmark-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Sahayak RSA Pass</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Service history */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => onGoToTab?.("activity")}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="document-text-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Service history</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 6. FRAME 6: "PAYMENT AND COUPONS" GROUPED SECTION ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Payment and coupons</Text>
          <View style={styles.groupedCard}>
            {/* Sahayak Cash */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert("Sahayak Cash", "₹450 available balance for instant rescue dispatch.");
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="wallet-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Sahayak Cash</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Payment settings */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Payment settings",
                  "Saved Methods:\n\n• Google Pay UPI (Default)\n• HDFC Bank Debit Card (**4912)\n• Cash to roadside partner"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="card-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Payment settings</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Coupons & discounts */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Coupons & discounts",
                  "Active Coupons:\n\n• FIRST50: Flat ₹50 off on towing\n• JUMP10: 10% off battery boost"
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="pricetag-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Coupons & discounts</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 7. FRAME 7: "OTHER INFORMATION" GROUPED SECTION ── */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionGroupTitle}>Other information</Text>
          <View style={styles.groupedCard}>
            {/* About Sahayak */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "About Sahayak 🇮🇳",
                  "Sahayak Roadside Mobility Platform\nVersion: 1.4.2\n\nKeeping Indian motorists moving 24/7."
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="information-circle-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>About Sahayak</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Terms & Privacy */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={() => {
                Alert.alert(
                  "Terms & Privacy",
                  "Sahayak ensures strict user privacy, secure payments, and verified roadside partner standards."
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="document-text-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Terms & Privacy policy</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Share the app */}
            <TouchableOpacity
              style={styles.groupedRow}
              onPress={handleShareApp}
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="share-social-outline" size={19} color="#1C1C1C" />
              </View>
              <Text style={styles.rowTitle}>Share the app</Text>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 8. FRAME 8: LOG OUT BUTTON CARD ── */}
        <View style={[styles.sectionMargin, { marginBottom: 44 }]}>
          <TouchableOpacity
            style={styles.logoutCard}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={20} color="#E23744" />
            <Text style={styles.logoutCardText}>Log out</Text>
          </TouchableOpacity>
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

  // 1. Hero Outer & Gradient Header
  heroOuterWrapper: {
    overflow: "hidden",
  },
  heroGradient: {
    paddingBottom: 22,
    alignItems: "center",
  },
  accountTopBarRow: {
    width: "100%",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  backCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  avatarCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    marginTop: 10,
    marginBottom: 12,
  },
  yourAccountTitle: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.4,
  },
  userPhoneText: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#5E6470",
    marginTop: 4,
    letterSpacing: 0.2,
  },

  // 2. Three Cards Row (Blinkit Exact)
  cardsRowWrapper: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 22,
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
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  walletRupeeBadge: {
    position: "relative",
  },
  rupeePill: {
    position: "absolute",
    top: 2,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#0C831F",
    alignItems: "center",
    justifyContent: "center",
  },
  rupeePillText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  threeCardTitle: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
    textAlign: "center",
  },

  // 3. Section Margins
  sectionMargin: {
    paddingHorizontal: 16,
    marginTop: 12,
  },

  // Appearance Card
  appearanceCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#EFF1F5",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  appearanceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  appearanceLabel: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    fontWeight: "600",
    color: "#1C1C1C",
  },
  appearanceRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  appearanceModeText: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#64748B",
    letterSpacing: 0.5,
  },

  // Safety Toggle Card
  toggleCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
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
  toggleIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E6F4EA",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleContent: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  toggleSub: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 15,
  },
  knowMoreLink: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#0C831F",
    marginTop: 3,
    textDecorationLine: "underline",
  },

  // Grouped Cards (Blinkit Exact)
  sectionGroupTitle: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    marginBottom: 8,
    letterSpacing: -0.2,
  },
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
  groupedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 14,
  },
  rowIcon: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#1C1C1C",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F2F5",
    marginLeft: 54,
  },

  // Logout Card
  logoutCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FDECEA",
    gap: 8,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
  },
  logoutCardText: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#E23744",
  },
});
