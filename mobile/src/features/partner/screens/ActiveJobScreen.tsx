// ─── Sahayak — Active Job Screen (Partner) ───────────────────────────────────
// Figma: partner-active-job — full map + job nav overlay
import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  Animated,
  Linking,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { MOCK_INCOMING_OFFER } from "../../../services/api";
import type { PartnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "ActiveJob">;
type Route = RouteProp<PartnerStackParamList, "ActiveJob">;

const PARTNER_LOC = { latitude: 12.9756, longitude: 77.5906 };
const USER_LOC = { latitude: 12.9716, longitude: 77.5946 };

export default function ActiveJobScreen() {
  const nav = useNavigation<Nav>();
  const job = MOCK_INCOMING_OFFER.job;
  const slideAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, []);

  const region = {
    latitude: (PARTNER_LOC.latitude + USER_LOC.latitude) / 2,
    longitude: (PARTNER_LOC.longitude + USER_LOC.longitude) / 2,
    latitudeDelta: 0.018,
    longitudeDelta: 0.018,
  };

  const handleNavigate = () => {
    const url = `https://maps.google.com/?q=${USER_LOC.latitude},${USER_LOC.longitude}`;
    Linking.openURL(url);
  };

  const handleDone = () => {
    nav.navigate("PartnerJobDone", { jobId: MOCK_INCOMING_OFFER.jobId });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Full map ── */}
      <MapView
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
      >
        <Marker coordinate={PARTNER_LOC} title="You">
          <View style={styles.partnerPin}>
            <Ionicons name="construct" size={14} color={Colors.textWhite} />
          </View>
        </Marker>
        <Marker coordinate={USER_LOC} title="Customer">
          <View style={styles.userPin}>
            <Ionicons name="person" size={14} color={Colors.primary} />
          </View>
        </Marker>
        <Polyline
          coordinates={[PARTNER_LOC, USER_LOC]}
          strokeColor={Colors.primary}
          strokeWidth={4}
          lineDashPattern={[8, 4]}
        />
      </MapView>

      {/* ── Top bar ── */}
      <SafeAreaView style={styles.topOverlay} edges={["top"]}>
        <View style={styles.topRow}>
          <View style={styles.activeBadge}>
            <Animated.View style={styles.activePulse} />
            <Text style={styles.activeBadgeText}>Job Active</Text>
          </View>
          <View style={styles.etaChip}>
            <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.etaChipText}>~8 min</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── My location button ── */}
      <TouchableOpacity style={styles.myLocBtn}>
        <Ionicons name="locate" size={22} color={Colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom Nav Card (Figma: bottom-overlay) ── */}
      <Animated.View
        style={[styles.sheet, Shadows.sheet as ViewStyle, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.sheetHandle} />

        <Text style={styles.sheetTitle}>Navigate to Customer</Text>

        {/* Customer snippet */}
        <View style={styles.customerRow}>
          <View style={styles.customerIcon}>
            <Ionicons name="person-circle" size={36} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.customerName}>Arjun Sharma</Text>
            <Text style={styles.customerAddress} numberOfLines={1}>
              {job.pickupLocation.address}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => Linking.openURL("tel:+919876543210")}
          >
            <Ionicons name="call" size={20} color={Colors.success} />
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statVal}>2.1 km</Text>
            <Text style={styles.statLbl}>Distance</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statVal}>~8 min</Text>
            <Text style={styles.statLbl}>ETA</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: Colors.success }]}>₹299</Text>
            <Text style={styles.statLbl}>Earnings</Text>
          </View>
        </View>

        {/* Buttons */}
        <View style={styles.btnsRow}>
          <Button
            label="Navigate"
            onPress={handleNavigate}
            variant="outline"
            size="md"
            icon={<Ionicons name="navigate" size={16} color={Colors.primary} />}
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <Button
            label="Mark Complete"
            onPress={handleDone}
            variant="primary"
            size="md"
            fullWidth={false}
            style={{ flex: 1.5 }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFill },

  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    gap: 8,
    ...(Shadows.card as object),
  },
  activePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  activeBadgeText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.success,
  },
  etaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    ...(Shadows.card as object),
  },
  etaChipText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textSecondary,
  },

  partnerPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  userPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.primary,
  },

  myLocBtn: {
    position: "absolute",
    right: Spacing.lg,
    bottom: 230,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    padding: Spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : Spacing.lg,
    gap: Spacing.md,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.shimmerBase,
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },
  sheetTitle: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  customerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  customerIcon: {},
  customerName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  customerAddress: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.successLight,
    alignItems: "center",
    justifyContent: "center",
  },

  statsRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statVal: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  statLbl: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
  },
  statDivider: { width: 1, backgroundColor: Colors.border },

  btnsRow: { flexDirection: "row", gap: Spacing.sm },
});

