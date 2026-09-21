// ─── Sahayak — Finding Partner Screen ────────────────────────────────────────
// Figma: owner-finding-partner — map + animated pulsing ring + cancel option
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  StatusBar,
  Alert,
} from "react-native";
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { useJobStore } from "../../../store/jobStore";
import type { OwnerStackParamList } from "../../../types";
import type { ViewStyle } from "react-native";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "FindingPartner">;
type Route = RouteProp<OwnerStackParamList, "FindingPartner">;

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

export default function FindingPartnerScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { draftPickupLocation } = useJobStore();

  const loc = draftPickupLocation ?? BENGALURU;
  const region = { ...loc, latitudeDelta: 0.018, longitudeDelta: 0.018 };

  // Pulsing animation
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const dotsAnim = useRef(new Animated.Value(0)).current;
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse1, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulse2, { toValue: 1, duration: 1200, delay: 400, useNativeDriver: true }),
          Animated.timing(pulse3, { toValue: 1, duration: 1200, delay: 800, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulse1, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(pulse2, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(pulse3, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();

    // Dot animation
    const dotInterval = setInterval(() => {
      setDotCount((d) => (d % 3) + 1);
    }, 600);

    // Auto-match after 4 seconds (demo)
    const matchTimeout = setTimeout(() => {
      nav.navigate("PartnerMatched", { jobId: route.params.jobId });
    }, 4000);

    return () => {
      loop.stop();
      clearInterval(dotInterval);
      clearTimeout(matchTimeout);
    };
  }, []);

  const pulseStyle = (anim: Animated.Value, maxScale: number) => ({
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, maxScale] }) }],
    opacity: anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.2, 0] }),
  });

  const handleCancel = () => {
    Alert.alert(
      "Cancel Request?",
      "Your request will be cancelled.",
      [
        { text: "No", style: "cancel" },
        { text: "Yes, Cancel", style: "destructive", onPress: () => nav.popToTop() },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Full-Screen Map ── */}
      <MapView
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        scrollEnabled={false}
        zoomEnabled={false}
      >
        {/* Pulsing circles (CSS-style rings on map) */}
        <Circle
          center={loc}
          radius={600}
          strokeColor="rgba(245,158,11,0.3)"
          fillColor="rgba(245,158,11,0.05)"
        />
        <Circle
          center={loc}
          radius={1200}
          strokeColor="rgba(245,158,11,0.15)"
          fillColor="rgba(245,158,11,0.02)"
        />
        <Marker coordinate={loc} pinColor={Colors.primary} />
      </MapView>

      {/* ── Animated pulse rings on top of map ── */}
      <View style={styles.pulseContainer} pointerEvents="none">
        {[pulse1, pulse2, pulse3].map((p, i) => (
          <Animated.View
            key={i}
            style={[
              styles.pulseRing,
              pulseStyle(p, 2.8 + i * 0.6),
              {
                width: 80 + i * 20,
                height: 80 + i * 20,
                borderRadius: (80 + i * 20) / 2,
                borderColor: Colors.primary,
                borderWidth: 2,
              },
            ]}
          />
        ))}
        {/* Center dot */}
        <View style={styles.centerDot}>
          <Ionicons name="location" size={22} color={Colors.primary} />
        </View>
      </View>

      {/* ── Top bar ── */}
      <SafeAreaView style={styles.topOverlay} edges={["top"]}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.iconBtn} onPress={handleCancel}>
            <Ionicons name="close" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.logoChip}>
            <Text style={styles.logoText}>Sahayak</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      {/* ── Bottom Sheet (Figma: finding-bottom-overlay) ── */}
      <View style={[styles.sheet, Shadows.sheet as ViewStyle]}>
        <View style={styles.sheetHandle} />

        {/* Spinner icon */}
        <View style={styles.searchIconWrap}>
          <Ionicons name="search-circle" size={52} color={Colors.primary} />
        </View>

        <Text style={styles.findingTitle}>
          Finding a Partner{"." .repeat(dotCount)}
        </Text>
        <Text style={styles.findingSubtitle}>
          We're searching for verified mechanics near your location
        </Text>

        {/* Status steps */}
        <View style={styles.steps}>
          {[
            { label: "Request Received", done: true },
            { label: "Searching Partners", done: true, active: true },
            { label: "Partner Matched", done: false },
            { label: "En Route to You", done: false },
          ].map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View
                style={[
                  styles.stepDot,
                  step.done && { backgroundColor: step.active ? Colors.primary : Colors.success },
                ]}
              >
                {step.done && !step.active && (
                  <Ionicons name="checkmark" size={10} color={Colors.textWhite} />
                )}
                {step.active && (
                  <Animated.View style={styles.activePulse} />
                )}
              </View>
              {i < 3 && <View style={[styles.stepLine, step.done && { backgroundColor: Colors.success }]} />}
              <Text
                style={[
                  styles.stepLabel,
                  step.active && { color: Colors.primary, fontFamily: Typography.fontFamily.semiBold },
                  !step.done && !step.active && { color: Colors.textMuted },
                ]}
              >
                {step.label}
              </Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}>
          <Text style={styles.cancelText}>Cancel Request</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFill },

  pulseContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    borderStyle: "solid",
  },
  centerDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
  },

  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
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
  logoChip: {
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.full,
    ...(Shadows.card as object),
  },
  logoText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
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
    alignItems: "center",
    gap: Spacing.sm,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.shimmerBase,
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },
  searchIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: Spacing.sm,
  },
  findingTitle: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  findingSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: Spacing.lg,
  },

  steps: {
    alignSelf: "stretch",
    paddingHorizontal: Spacing.base,
    marginTop: Spacing.base,
    gap: 0,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    paddingBottom: 0,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.shimmerBase,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    zIndex: 1,
  },
  activePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textWhite,
  },
  stepLine: {
    position: "absolute",
    left: 9,
    top: 22,
    width: 2,
    height: 28,
    backgroundColor: Colors.shimmerBase,
  },
  stepLabel: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    paddingBottom: Spacing.lg,
    flex: 1,
  },

  cancelLink: { paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  cancelText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.error,
    fontFamily: Typography.fontFamily.semiBold,
    textDecorationLine: "underline",
  },
});

