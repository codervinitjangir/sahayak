import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, AccessibilityInfo } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import LogoMark from "../brand/LogoMark";
import { Colors, Typography } from "../../constants/theme";

export interface AppLaunchSequenceProps {
  onAnimationComplete?: () => void;
  /** Fonts (and anything else the first screen needs) are ready. */
  isReady?: boolean;
  debug?: boolean;
}

const MIN_VISIBLE_MS = 700;

/**
 * Launch screen: the Sahayak mark on brand teal, a short hold, then a fade into
 * the app. It matches the native splash (same colour) so there is no flash, and
 * it is skipped down to a plain fade when the system asks for reduced motion.
 */
export default function AppLaunchSequence({ onAnimationComplete, isReady = true }: AppLaunchSequenceProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const shownAt = useRef(Date.now());
  const done = useRef(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }).start();
  }, [scale]);

  useEffect(() => {
    if (!isReady || done.current) return;
    done.current = true;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
    const id = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => onAnimationComplete?.());
    }, wait);
    return () => clearTimeout(id);
  }, [isReady, opacity, onAnimationComplete]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.("Sahayak");
  }, []);

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents="auto" accessibilityLabel="Sahayak is loading">
      <Animated.View style={{ transform: [{ scale }], alignItems: "center", gap: 14 }}>
        <LogoMark size={88} tile={false} />
        <Text style={styles.word}>Sahayak</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", zIndex: 1000 },
  word: { color: "#fff", fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, letterSpacing: Typography.letterSpacing.display },
});
