// ─── BlinkitTopHeader.tsx ──────────────────────────────────────────────────────
// Signature Blinkit Yellow Top Header (Unified across Home, Services & Rescues)
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "../../constants/theme";

interface BlinkitTopHeaderProps {
  tab: "home" | "services" | "activity";
  locationText?: string;
  etaText?: string;
  walletBalance?: string;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (text: string) => void;
  onLocationPress?: () => void;
  onWalletPress?: () => void;
  onProfilePress?: () => void;
  onSearchSubmit?: () => void;
}

export default function BlinkitTopHeader({
  tab,
  locationText = "Indiranagar 100ft Rd, HAL 2nd Stage",
  etaText = "12 minutes",
  walletBalance = "₹0",
  searchPlaceholder,
  searchQuery,
  onSearchChange,
  onLocationPress,
  onWalletPress,
  onProfilePress,
  onSearchSubmit,
}: BlinkitTopHeaderProps) {
  const insets = useSafeAreaInsets();
  const topInset =
    insets.top > 0
      ? insets.top
      : Platform.OS === "android"
      ? (StatusBar.currentHeight ?? 32)
      : 44;

  const defaultPlaceholder =
    tab === "services"
      ? 'Search "flatbed towing, jumpstart, tyre..."'
      : tab === "activity"
      ? 'Search "past rescues, invoices, bills..."'
      : 'Search "mechanic, towing, flat tyre..."';

  const contextLabel =
    tab === "services"
      ? "Services in"
      : tab === "activity"
      ? "Rescues in"
      : "Sahayak in";

  return (
    <View style={styles.headerWrapper}>
      <LinearGradient
        colors={["#F8CB46", "#FDE068", "#FDE068", "#FEF6D8", "#F5F6F8"]}
        locations={[0, 0.35, 0.65, 0.88, 1]}
        style={[styles.gradientHeader, { paddingTop: topInset + 6 }]}
      >
        {/* ── ROW 1: Location & ETA (Left) + Wallet & Avatar (Right) ── */}
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.locationCol}
            onPress={onLocationPress}
            activeOpacity={0.8}
          >
            <Text style={styles.contextLabel}>{contextLabel}</Text>
            <Text style={styles.etaText}>{etaText}</Text>
            <View style={styles.locationPillRow}>
              <Text style={styles.locationText} numberOfLines={1}>
                {locationText}
              </Text>
              <Ionicons name="chevron-down" size={13} color="#1C1C1C" />
            </View>
          </TouchableOpacity>

          <View style={styles.rightActions}>
            {/* Wallet pill */}
            <TouchableOpacity
              style={styles.walletBadge}
              onPress={onWalletPress}
              activeOpacity={0.8}
            >
              <Ionicons name="wallet" size={15} color="#0C831F" />
              <Text style={styles.walletText}>{walletBalance}</Text>
            </TouchableOpacity>

            {/* Profile Squircle button matching reference */}
            <TouchableOpacity
              style={styles.profileSquircle}
              onPress={onProfilePress}
              activeOpacity={0.8}
            >
              <Ionicons name="person-outline" size={22} color="#1C1C1C" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── ROW 2: White Search Bar (Blinkit Exact) ── */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#1C1C1C" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder || defaultPlaceholder}
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
              onPress={() => onSearchChange("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#8C93A3" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity activeOpacity={0.7}>
              <Ionicons name="mic" size={18} color="#1C1C1C" />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    backgroundColor: "#F5F6F8",
    zIndex: 100,
  },
  gradientHeader: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  locationCol: {
    flex: 1,
    paddingRight: 12,
  },
  contextLabel: {
    fontSize: 11.5,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#1C1C1C",
    letterSpacing: 0.2,
    marginBottom: 1,
  },
  etaText: {
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "900",
    color: "#1C1C1C",
    letterSpacing: -0.6,
    lineHeight: 26,
    marginBottom: 3,
  },
  locationPillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  locationText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: "600",
    color: "#1C1C1C",
    maxWidth: "88%",
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
  },
  walletBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    height: 46,
    paddingHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
    paddingVertical: 0,
  },
});
