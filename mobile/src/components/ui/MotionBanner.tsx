// ─── MotionBanner.tsx ──────────────────────────────────────────────────────────
// Modern Flat Top Header & Hero Banner in Sahayak Template Colors (#F8CB46 Yellow & #1C1C1C Charcoal).
// Features the soft Account-section top bar gradient, single clean static screen (mechanic hero),
// with no swipe/carousel or scrolling section.

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Dimensions,
  Platform,
  StyleProp,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Typography, Radius } from "../../constants/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export interface MotionBannerProps {
  // Integrated Header Props (Location, search & profile row)
  topInset?: number;
  locationText?: string;
  etaText?: string;
  walletBalance?: string;
  searchPlaceholder?: string;
  searchQuery?: string;
  onSearchChange?: (text: string) => void;
  onLocationPress?: () => void;
  onWalletPress?: () => void;
  onProfilePress?: () => void;
  onSearchSubmit?: () => void;

  // Banner Content Props
  categoryTag?: string;
  lineOneText?: string;
  lineTwoText?: string;
  lineOneColor?: string;
  lineTwoColor?: string;
  buttonLabel?: string;
  heroImage?: any;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  height?: number;
}

export default function MotionBanner({
  topInset,
  locationText,
  etaText = "In 12 minutes",
  walletBalance = "₹0",
  searchPlaceholder = "Search for 'mechanic, towing, flat tyre...'",
  searchQuery = "",
  onSearchChange,
  onLocationPress,
  onWalletPress,
  onProfilePress,
  onSearchSubmit,
  categoryTag = "Roadside rescue",
  lineOneText = "Get additional 25% off",
  lineTwoText = "on your first booking",
  lineOneColor,
  lineTwoColor,
  buttonLabel = "Book now",
  heroImage = require("../../../assets/hero_mechanic_clean.png"),
  onPress,
  style,
  height,
}: MotionBannerProps) {
  const hasIntegratedHeader = !!locationText;
  const calculatedInset = topInset ?? (Platform.OS === "android" ? 32 : 44);

  // Format ETA: ensure "In " prefix matching the reference
  const formattedEta = etaText?.startsWith("In ") ? etaText : `In ${etaText}`;

  return (
    <View style={[styles.outerContainer, style]}>
      <LinearGradient
        colors={["#F8CB46", "#FDE068", "#FDE068", "#FEF6D8", "#F5F6F8"]}
        locations={[0, 0.28, 0.58, 0.85, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.gradientContainer,
          { paddingTop: calculatedInset + 8 },
          height ? { height } : undefined,
        ]}
      >
        {/* ── 1. TOP ROW: LOCATION PIN & ADDRESS (LEFT) + PROFILE SQUIRCLE (RIGHT) ── */}
        {hasIntegratedHeader && (
          <View style={styles.topRow}>
            {/* Left Location Column */}
            <TouchableOpacity
              style={styles.locationContainer}
              onPress={onLocationPress}
              activeOpacity={0.8}
            >
              {/* Pin Icon in light circle badge */}
              <View style={styles.pinCircle}>
                <Ionicons name="location-sharp" size={17} color="#1C1C1C" />
              </View>

              <View style={styles.locationTextCol}>
                <Text style={styles.etaText} numberOfLines={1}>
                  {formattedEta}
                </Text>
                <View style={styles.addressRow}>
                  <Text style={styles.addressText} numberOfLines={1}>
                    {locationText}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color="#42371E"
                    style={{ marginLeft: 2 }}
                  />
                </View>
              </View>
            </TouchableOpacity>

            {/* Right Action Icons (Profile Squircle matching reference) */}
            <View style={styles.rightActions}>
              {walletBalance && walletBalance !== "₹0" && (
                <TouchableOpacity
                  style={styles.walletBadge}
                  onPress={onWalletPress}
                  activeOpacity={0.8}
                >
                  <Ionicons name="wallet" size={14} color="#0C831F" />
                  <Text style={styles.walletText}>{walletBalance}</Text>
                </TouchableOpacity>
              )}

              {/* White Squircle Profile Button */}
              <TouchableOpacity
                style={styles.profileSquircle}
                onPress={onProfilePress}
                activeOpacity={0.8}
              >
                <Ionicons name="person-outline" size={22} color="#1C1C1C" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 2. WHITE SQUIRCLE SEARCH BAR ── */}
        {hasIntegratedHeader && (
          <View style={styles.searchBar}>
            <Ionicons
              name="search-outline"
              size={20}
              color="#5E6470"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor="#8C93A3"
              value={searchQuery}
              onChangeText={onSearchChange}
              onSubmitEditing={onSearchSubmit}
              returnKeyType="search"
              clearButtonMode="never"
              autoCorrect={false}
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => onSearchChange?.("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={18} color="#8C93A3" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity activeOpacity={0.7}>
                <Ionicons name="mic-outline" size={19} color="#5E6470" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 3. STATIC FLAT HERO BANNER SECTION (ONLY THIS SCREEN SHOWS) ── */}
        <View style={styles.heroSection}>
          {/* Left Text Block */}
          <View style={styles.heroLeftCol}>
            <Text style={styles.categoryTag}>{categoryTag}</Text>
            <Text
              style={[
                styles.headlineText,
                lineOneColor ? { color: lineOneColor } : undefined,
              ]}
              numberOfLines={1}
            >
              {lineOneText}
            </Text>
            <Text
              style={[
                styles.headlineText,
                lineTwoColor ? { color: lineTwoColor } : undefined,
              ]}
              numberOfLines={1}
            >
              {lineTwoText}
            </Text>

            {/* Flat CTA Link with Arrow "Book now →" */}
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={onPress}
              activeOpacity={0.75}
            >
              <Text style={styles.ctaText}>{buttonLabel}</Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color="#1C1C1C"
                style={styles.ctaArrow}
              />
            </TouchableOpacity>
          </View>

          {/* Right Cutout Image with Translucent Backdrop */}
          <View style={styles.heroRightCol}>
            {/* Soft Translucent Squircle Backdrop */}
            <View style={styles.backdropSquircle} />

            {/* Technician Cutout (Smiling pro in Sahayak uniform) */}
            <Image
              source={heroImage}
              style={styles.heroImage}
              resizeMode="contain"
            />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    width: "100%",
    backgroundColor: "#F5F6F8",
  },
  gradientContainer: {
    width: "100%",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  // Top Location & Profile Row
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  locationContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 10,
  },
  pinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  locationTextCol: {
    flex: 1,
  },
  etaText: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    letterSpacing: -0.3,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 1,
  },
  addressText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "500",
    color: "#42371E",
    maxWidth: "88%",
  },

  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  walletBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.full,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  walletText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
  },
  profileSquircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },

  // Search Bar
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    marginBottom: 6,
  },
  searchIcon: {
    marginRight: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
    paddingVertical: 0,
  },

  // Flat Hero Banner Section (Single Static Screen)
  heroSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 4,
    minHeight: 140,
    position: "relative",
  },
  heroLeftCol: {
    flex: 1.25,
    justifyContent: "center",
    paddingRight: 6,
    zIndex: 10,
  },
  categoryTag: {
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#4A3E1E",
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  headlineText: {
    fontSize: 20.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "800",
    color: "#1C1C1C",
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 14,
    paddingVertical: 4,
  },
  ctaText: {
    fontSize: 15,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
  },
  ctaArrow: {
    marginLeft: 6,
  },

  // Hero Right Column & Cutout
  heroRightCol: {
    flex: 0.95,
    height: 140,
    alignItems: "center",
    justifyContent: "flex-end",
    position: "relative",
  },
  backdropSquircle: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 30,
    backgroundColor: "rgba(255, 255, 255, 0.65)",
    bottom: 8,
    right: 6,
    transform: [{ rotate: "-8deg" }],
  },
  heroImage: {
    width: 135,
    height: 140,
    bottom: 2,
    zIndex: 5,
  },
});
