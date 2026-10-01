// ─── Sahayak — Sliding Bottom Sheet Component ─────────────────────────────
// Real sliding/animated bottom sheet that changes height per state
import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Animated,
  Platform,
  type ViewStyle,
} from "react-native";
import { Colors, Radius, Shadows } from "../../constants/theme";

export type SheetHeightVariant = "idle" | "half" | "peek" | "compact" | "expanded";

interface SlidingBottomSheetProps {
  heightVariant?: SheetHeightVariant;
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function SlidingBottomSheet({
  heightVariant = "idle",
  children,
  style,
}: SlidingBottomSheetProps) {
  // Height configurations per variant:
  // 'idle' (~38%): Home search bar, vehicle selector, and suggestions carousel
  // 'half' (~54%): Service list & upfront pricing options
  // 'peek' (~28%): Pickup confirmation & radar searching
  // 'compact' (~44%): Matched / active tracking with OTP
  // 'expanded' (~68%): Full service details or completed summary
  const targetHeightPercent =
    heightVariant === "idle"
      ? "38%"
      : heightVariant === "half"
      ? "54%"
      : heightVariant === "compact"
      ? "44%"
      : heightVariant === "expanded"
      ? "68%"
      : "28%";

  const slideAnim = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    slideAnim.setValue(30);
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [heightVariant]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: targetHeightPercent,
          transform: [{ translateY: slideAnim }],
        },
        Shadows.sheet as ViewStyle,
        style,
      ]}
    >
      {/* ── Minimal Neutral Greyscale Drag Handle ── */}
      <View style={styles.handleBar} />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
    zIndex: 20,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 10,
  },
});
