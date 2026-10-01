// ─── Sahayak — High-Fidelity Vector Mock Map Canvas ───────────────────────────
// Fully standalone vector street map that renders reliably in Expo Go without
// requiring Google Play Services or an active Google Maps API key.
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, Radius, Shadows } from "../../constants/theme";
import type { LatLng } from "../../types";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export interface MockMapCanvasProps {
  userLocation?: LatLng;
  partnerLocation?: LatLng | null;
  showRoute?: boolean;
  showRadar?: boolean;
  radarRadius?: number;
  draggable?: boolean;
  onUserMarkerDragEnd?: (coord: LatLng) => void;
  showBackButton?: boolean;
  onBackPress?: () => void;
  topStatusText?: string;
  showAmbientPartners?: boolean;
  showFloatingButtons?: boolean;
  onSharePress?: () => void;
  onHelpPress?: () => void;
  onProfilePress?: () => void;
  children?: React.ReactNode;
}

export default function MockMapCanvas({
  userLocation = { latitude: 12.9716, longitude: 77.5946 },
  partnerLocation,
  showRoute = false,
  showRadar = false,
  showBackButton = false,
  onBackPress,
  topStatusText,
  showAmbientPartners = false,
  showFloatingButtons = false,
  onSharePress,
  onHelpPress,
  onProfilePress,
  children,
}: MockMapCanvasProps) {
  // Pulsing radar animation for "Finding Partner"
  const pulseAnim1 = useRef(new Animated.Value(0)).current;
  const pulseAnim2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showRadar) return;

    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const p1 = createPulse(pulseAnim1, 0);
    const p2 = createPulse(pulseAnim2, 800);

    p1.start();
    p2.start();

    return () => {
      p1.stop();
      p2.stop();
    };
  }, [showRadar]);

  // Center user pin in upper third (so bottom sheet doesn't obscure it)
  const userPinX = SCREEN_WIDTH * 0.5;
  const userPinY = SCREEN_HEIGHT * 0.28;

  // Partner pin positioned slightly north-east along arterial road
  const partnerPinX = SCREEN_WIDTH * 0.74;
  const partnerPinY = SCREEN_HEIGHT * 0.15;

  return (
    <View style={styles.container}>
      {/* ── Realistic Uber/Ola Vector Map Canvas ── */}
      <View style={styles.mapCanvas}>
        {/* Background landmass */}
        <View style={styles.landmass} />

        {/* Urban Building Footprint Blocks */}
        <View style={[styles.buildingBlock, { top: 80, left: 20, width: 90, height: 60 }]} />
        <View style={[styles.buildingBlock, { top: 70, left: 130, width: 80, height: 50 }]} />
        <View style={[styles.buildingBlock, { top: 150, left: 30, width: 110, height: 80 }]} />
        <View style={[styles.buildingBlock, { top: 140, right: 30, width: 100, height: 70 }]} />
        <View style={[styles.buildingBlock, { top: 240, left: 40, width: 120, height: 90 }]} />
        <View style={[styles.buildingBlock, { top: 230, right: 25, width: 110, height: 80 }]} />
        <View style={[styles.buildingBlock, { top: 340, left: 30, width: 130, height: 75 }]} />
        <View style={[styles.buildingBlock, { top: 330, right: 40, width: 120, height: 85 }]} />

        {/* Green Park Zones (Uber subtle mint) */}
        <View style={[styles.parkZone, { top: 50, right: 20, width: 130, height: 75 }]}>
          <Text style={styles.parkLabel}>Indiranagar Park</Text>
        </View>
        <View style={[styles.parkZone, { top: 320, left: 15, width: 105, height: 90 }]}>
          <Text style={styles.parkLabel}>Defence Colony</Text>
        </View>

        {/* Blue Water Body / Lake */}
        <View style={[styles.waterZone, { top: 180, right: -20, width: 110, height: 110 }]} />

        {/* ── Street Network ── */}
        <View style={[styles.secondaryStreetH, { top: 130 }]} />
        <View style={[styles.secondaryStreetH, { top: 220 }]} />
        <View style={[styles.secondaryStreetH, { top: 310 }]} />
        <View style={[styles.secondaryStreetH, { top: 400 }]} />
        <View style={[styles.secondaryStreetV, { left: 90 }]} />
        <View style={[styles.secondaryStreetV, { left: 190 }]} />
        <View style={[styles.secondaryStreetV, { left: 290 }]} />

        {/* Major Arterial Avenues (Prominent light roads) */}
        <View
          style={[
            styles.majorAvenue,
            {
              top: 140,
              left: -40,
              width: SCREEN_WIDTH + 80,
              transform: [{ rotate: "22deg" }],
            },
          ]}
        >
          <Text style={styles.roadName}>100 FEET ROAD</Text>
        </View>

        <View
          style={[
            styles.majorAvenue,
            {
              top: 230,
              left: -40,
              width: SCREEN_WIDTH + 80,
              transform: [{ rotate: "-28deg" }],
            },
          ]}
        >
          <Text style={styles.roadName}>OLD AIRPORT ROAD</Text>
        </View>

        <View
          style={[
            styles.expressway,
            {
              top: -20,
              left: SCREEN_WIDTH * 0.46,
              height: SCREEN_HEIGHT * 0.65,
            },
          ]}
        >
          <Text style={styles.verticalRoadName}>INNER RING ROAD</Text>
        </View>

        {/* ── Ambient Nearby-Partner Icons (Muted, decorative ambiance) ── */}
        {showAmbientPartners && (
          <>
            <View style={[styles.ambientPartnerPin, { top: userPinY - 75, left: userPinX - 90 }]}>
              <Ionicons name="construct" size={13} color="#64748B" />
            </View>
            <View style={[styles.ambientPartnerPin, { top: userPinY - 45, left: userPinX + 95 }]}>
              <Ionicons name="construct" size={13} color="#64748B" />
            </View>
            <View style={[styles.ambientPartnerPin, { top: userPinY + 80, left: userPinX - 80 }]}>
              <Ionicons name="car" size={13} color="#64748B" />
            </View>
          </>
        )}

        {/* ── Route Polyline (Teal #F8CB46 high-contrast line) ── */}
        {showRoute && (
          <View style={styles.routeContainer} pointerEvents="none">
            <View
              style={[
                styles.routeSegment,
                {
                  top: partnerPinY + 12,
                  left: userPinX + 2,
                  width: (partnerPinX - userPinX) + 8,
                  height: 5,
                  transform: [{ rotate: "-25deg" }],
                },
              ]}
            />
            <View
              style={[
                styles.routeSegment,
                {
                  top: (partnerPinY + userPinY) / 2 + 5,
                  left: userPinX - 6,
                  width: 5,
                  height: userPinY - partnerPinY - 10,
                },
              ]}
            />
            <View
              style={[
                styles.routeEtaPill,
                {
                  top: (partnerPinY + userPinY) / 2 - 10,
                  left: (partnerPinX + userPinX) / 2 - 35,
                },
              ]}
            >
              <Ionicons name="flash" size={11} color={Colors.brand700} />
              <Text style={styles.routeEtaText}>2.1 km · 8 min</Text>
            </View>
          </View>
        )}

        {/* ── Animated Radar Waves (Finding Partner) ── */}
        {showRadar && (
          <View
            style={[
              styles.radarCenter,
              { left: userPinX - 100, top: userPinY - 100 },
            ]}
            pointerEvents="none"
          >
            <Animated.View
              style={[
                styles.radarRing,
                {
                  transform: [
                    {
                      scale: pulseAnim1.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1.8],
                      }),
                    },
                  ],
                  opacity: pulseAnim1.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0.8, 0.4, 0],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.radarRing,
                {
                  transform: [
                    {
                      scale: pulseAnim2.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1.8],
                      }),
                    },
                  ],
                  opacity: pulseAnim2.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0.8, 0.4, 0],
                  }),
                },
              ]}
            />
          </View>
        )}

        {/* ── Partner Pin (Mechanic badge in navy #1C1C1C) ── */}
        {partnerLocation && (
          <View
            style={[
              styles.pinWrapper,
              { left: partnerPinX - 20, top: partnerPinY - 20 },
            ]}
          >
            <View style={styles.partnerPinBadge}>
              <Ionicons name="construct" size={16} color={Colors.textWhite} />
            </View>
            <View style={styles.pinTag}>
              <Text style={styles.pinTagText}>Ravi (Mechanic)</Text>
            </View>
          </View>
        )}

        {/* ── User Pin (Custom distinct teal ring) ── */}
        <View
          style={[
            styles.pinWrapper,
            { left: userPinX - 22, top: userPinY - 22 },
          ]}
        >
          <View style={styles.userPinPulse} />
          <View style={styles.userPinBadge}>
            <Ionicons name="location" size={20} color={Colors.brand700} />
          </View>
          <View style={styles.userPinDot} />
          <View style={styles.breakdownLabelTag}>
            <Text style={styles.breakdownLabelText}>Your Breakdown Spot</Text>
          </View>
        </View>

        {children}
      </View>

      {/* ── Two Persistent Floating Map Buttons (Share Status & Support) ── */}
      {showFloatingButtons && (
        <View style={styles.floatingActionCol} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.floatingCircleBtn}
            onPress={onSharePress}
            activeOpacity={0.8}
            accessibilityLabel="Share job status"
            accessibilityRole="button"
          >
            <Ionicons name="share-social-outline" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingCircleBtn}
            onPress={onHelpPress}
            activeOpacity={0.8}
            accessibilityLabel="Emergency help and support"
            accessibilityRole="button"
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={Colors.brand700} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Minimal Chrome: 44px circular floating back button & Profile pill ── */}
      <SafeAreaView style={styles.floatingHeader} edges={["top"]} pointerEvents="box-none">
        {showBackButton ? (
          <TouchableOpacity
            style={styles.floatingBackBtn}
            onPress={onBackPress}
            activeOpacity={0.8}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}

        {topStatusText ? (
          <View style={styles.topStatusPill}>
            <View style={styles.liveGreenDot} />
            <Text style={styles.topStatusText}>{topStatusText}</Text>
          </View>
        ) : null}

        {onProfilePress ? (
          <TouchableOpacity
            style={styles.floatingBackBtn}
            onPress={onProfilePress}
            activeOpacity={0.8}
            accessibilityLabel="View profile and account"
            accessibilityRole="button"
          >
            <Ionicons name="person-circle-outline" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: "#F1F5F9",
  },
  mapCanvas: {
    ...(StyleSheet.absoluteFill as object),
    overflow: "hidden",
  },
  landmass: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: "#F8FAFC",
  },

  // City blocks
  buildingBlock: {
    position: "absolute",
    backgroundColor: "#EDF2F7",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  parkZone: {
    position: "absolute",
    backgroundColor: "#DCFCE7",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    padding: 6,
    justifyContent: "flex-end",
  },
  parkLabel: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.semiBold,
    color: "#166534",
    opacity: 0.8,
  },
  waterZone: {
    position: "absolute",
    backgroundColor: "#E0F2FE",
    borderRadius: 60,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },

  // Streets
  secondaryStreetH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#E2E8F0",
  },
  secondaryStreetV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: "#E2E8F0",
  },
  majorAvenue: {
    position: "absolute",
    height: 14,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: "#CBD5E1",
    justifyContent: "center",
    paddingHorizontal: 20,
    ...(Shadows.card as object),
  },
  expressway: {
    position: "absolute",
    width: 16,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    ...(Shadows.card as object),
  },
  roadName: {
    fontSize: 8,
    fontFamily: Typography.fontFamily.bold,
    color: "#64748B",
    letterSpacing: 1.5,
  },
  verticalRoadName: {
    fontSize: 7,
    fontFamily: Typography.fontFamily.bold,
    color: "#64748B",
    letterSpacing: 1,
    transform: [{ rotate: "90deg" }],
    width: 140,
    textAlign: "center",
  },

  // Ambient Partner Pins
  ambientPartnerPin: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    opacity: 0.8,
    ...(Shadows.card as object),
  },

  // Route Polyline
  routeContainer: {
    ...(StyleSheet.absoluteFill as object),
  },
  routeSegment: {
    position: "absolute",
    backgroundColor: "#F8CB46",
    borderRadius: 3,
  },
  routeEtaPill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "#F8CB46",
    ...(Shadows.card as object),
  },
  routeEtaText: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    color: "#F8CB46",
  },

  // Radar Animation
  radarCenter: {
    position: "absolute",
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  radarRing: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: "#F8CB46",
    backgroundColor: "rgba(15, 118, 110, 0.08)",
  },

  // Pins
  pinWrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  userPinPulse: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 118, 110, 0.2)",
  },
  userPinBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#F8CB46",
    ...(Shadows.card as object),
  },
  userPinDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F8CB46",
  },
  breakdownLabelTag: {
    marginTop: 4,
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    ...(Shadows.card as object),
  },
  breakdownLabelText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },

  partnerPinBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#1C1C1C",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: Colors.surfaceWhite,
    ...(Shadows.card as object),
  },
  pinTag: {
    marginTop: 4,
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  pinTagText: {
    fontSize: 9,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },

  // Floating Action Column on right edge of map (min 44px)
  floatingActionCol: {
    position: "absolute",
    right: 16,
    top: SCREEN_HEIGHT * 0.38,
    gap: 12,
    zIndex: 15,
  },
  floatingCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    ...(Shadows.card as object),
  },

  // Chrome Header
  floatingHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 20,
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
    ...(Shadows.card as object),
  },
  topStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    ...(Shadows.card as object),
  },
  liveGreenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0C831F",
  },
  topStatusText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
});
