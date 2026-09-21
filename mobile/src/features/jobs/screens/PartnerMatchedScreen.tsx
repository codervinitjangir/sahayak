// ─── Sahayak — Partner Matched Screen ────────────────────────────────────────
// Figma: owner-partner-matched — map + partner card + call/chat
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  Linking,
  Animated,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Avatar from "../../../components/ui/Avatar";
import RatingStars from "../../../components/ui/RatingStars";
import Button from "../../../components/ui/Button";
import { MOCK_PARTNER } from "../../../services/api";
import { useJobStore } from "../../../store/jobStore";
import type { OwnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "PartnerMatched">;
type Route = RouteProp<OwnerStackParamList, "PartnerMatched">;

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
const PARTNER_LOC = { latitude: 12.9756, longitude: 77.5906 };

export default function PartnerMatchedScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { draftPickupLocation } = useJobStore();
  const partner = MOCK_PARTNER;
  const slideAnim = useRef(new Animated.Value(100)).current;

  const userLoc = draftPickupLocation ?? BENGALURU;
  const region = {
    latitude: (userLoc.latitude + PARTNER_LOC.latitude) / 2,
    longitude: (userLoc.longitude + PARTNER_LOC.longitude) / 2,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, []);

  const handleCall = () => {
    Linking.openURL(`tel:${partner.phone}`);
  };

  const handleJobComplete = () => {
    nav.navigate("JobComplete", { jobId: route.params.jobId });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Full-Screen Map ── */}
      <MapView
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
      >
        {/* User marker */}
        <Marker coordinate={userLoc} title="Your Location">
          <View style={styles.userPin}>
            <Ionicons name="location" size={18} color={Colors.primary} />
          </View>
        </Marker>

        {/* Partner marker */}
        <Marker coordinate={PARTNER_LOC} title={partner.name}>
          <View style={styles.partnerPin}>
            <Ionicons name="construct" size={14} color={Colors.textWhite} />
          </View>
        </Marker>

        {/* Route line */}
        <Polyline
          coordinates={[PARTNER_LOC, userLoc]}
          strokeColor={Colors.primary}
          strokeWidth={3}
          lineDashPattern={[8, 4]}
        />
      </MapView>

      {/* ── Top back button ── */}
      <SafeAreaView style={styles.topOverlay} edges={["top"]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => nav.goBack()}>
          <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── Partner Card Sheet (Figma: matched-bottom-overlay) ── */}
      <Animated.View
        style={[styles.sheet, Shadows.sheet as ViewStyle, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.sheetHandle} />

        {/* ETA banner */}
        <View style={styles.etaBanner}>
          <Ionicons name="time-outline" size={18} color={Colors.success} />
          <Text style={styles.etaText}>
            Your partner arrives in{" "}
            <Text style={styles.etaHighlight}>{partner.etaMinutes} min</Text>
          </Text>
        </View>

        {/* Partner info */}
        <View style={styles.partnerRow}>
          <Avatar name={partner.name} size={56} showOnline isOnline={partner.isOnline} />
          <View style={styles.partnerInfo}>
            <View style={styles.partnerNameRow}>
              <Text style={styles.partnerName}>{partner.name}</Text>
              {partner.isVerified && (
                <Ionicons name="shield-checkmark" size={16} color={Colors.info} />
              )}
            </View>
            <View style={styles.ratingRow}>
              <RatingStars value={Math.round(partner.rating)} size={14} readonly />
              <Text style={styles.ratingText}>{partner.rating} · {partner.totalJobs} jobs</Text>
            </View>
            <Text style={styles.vehicleText}>
              🚗 {partner.vehicleModel} · {partner.vehicleNumber}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.actionBtns}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleCall}>
              <Ionicons name="call" size={20} color={Colors.success} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.infoLight }]}>
              <Ionicons name="chatbubble-ellipses" size={20} color={Colors.info} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Distance row */}
        <View style={styles.distanceRow}>
          <View style={styles.distanceItem}>
            <Ionicons name="navigate-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.distanceLabel}>{partner.distanceKm} km away</Text>
          </View>
          <View style={styles.distanceDivider} />
          <View style={styles.distanceItem}>
            <Ionicons name="star" size={16} color={Colors.primary} />
            <Text style={styles.distanceLabel}>{partner.rating} rating</Text>
          </View>
          <View style={styles.distanceDivider} />
          <View style={styles.distanceItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.distanceLabel}>Verified</Text>
          </View>
        </View>

        {/* Demo: mark as done button */}
        <Button
          label="Mark Job Complete (Demo)"
          onPress={handleJobComplete}
          variant="outline"
          size="md"
        />
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
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
  partnerPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
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

  etaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.successLight,
    paddingHorizontal: Spacing.base,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  etaText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.success,
  },
  etaHighlight: {
    fontFamily: Typography.fontFamily.bold,
  },

  partnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  partnerInfo: { flex: 1 },
  partnerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  partnerName: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  ratingText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  vehicleText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
  },
  actionBtns: { gap: 8 },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.successLight,
    alignItems: "center",
    justifyContent: "center",
  },

  distanceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  distanceItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  distanceDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border,
  },
  distanceLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.medium,
  },
});

