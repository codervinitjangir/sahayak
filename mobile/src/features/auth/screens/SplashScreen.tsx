// ─── Sahayak — Uber-Style Animated Splash Screen ───────────────────────────────
// Step 1 in user sequence: High-production motion animation with logo zoom,
// subtle glow pulse, and smooth transition to Login screen.
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  StatusBar,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Typography, Radius } from "../../../constants/theme";
import type { AuthStackParamList } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function SplashScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, "Splash">>();

  // Animation values
  const logoScale = useRef(new Animated.Value(0.65)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const glowScale = useRef(new Animated.Value(0.8)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Entrance animation: Logo zoom + fade in
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 45,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Text slide-up & fade in after 400ms
    Animated.parallel([
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 800,
        delay: 400,
        useNativeDriver: true,
      }),
      Animated.timing(textTranslateY, {
        toValue: 0,
        duration: 800,
        delay: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // 3. Subtle continuous pulse glow
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.25,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 0.95,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 4. Progress bar fill over 2.2 seconds
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2200,
      useNativeDriver: false,
    }).start();

    // 5. Auto-transition to Login after 2.4 seconds
    const timer = setTimeout(() => {
      handleProceed();
    }, 2400);

    return () => clearTimeout(timer);
  }, []);

  const handleProceed = () => {
    navigation.replace("Login", {});
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={1}
      onPress={handleProceed}
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Background glow circle */}
      <Animated.View
        style={[
          styles.glowCircle,
          {
            transform: [{ scale: glowScale }],
          },
        ]}
      />

      {/* Main Logo & Wordmark Motion Block */}
      <View style={styles.centerBlock}>
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          {/* Hexagonal Shield Logo Emblem */}
          <View style={styles.shieldEmblem}>
            <Ionicons name="flash" size={38} color="#FFFFFF" />
          </View>
        </Animated.View>

        {/* Wordmark & Tagline */}
        <Animated.View
          style={[
            styles.textContainer,
            {
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
            },
          ]}
        >
          <Text style={styles.wordmark}>SAHAYAK</Text>
          <View style={styles.subtitleRow}>
            <View style={styles.subLine} />
            <Text style={styles.tagline}>ROADSIDE RESCUE</Text>
            <View style={styles.subLine} />
          </View>
        </Animated.View>
      </View>

      {/* Bottom Progress & Skip Prompt */}
      <View style={styles.bottomBlock}>
        <Text style={styles.bottomTagline}>24/7 Roadside Assistance · Always On Time</Text>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
        </View>
        <Text style={styles.tapPrompt}>Tap anywhere to skip</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  glowCircle: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(15, 118, 110, 0.22)",
  },
  centerBlock: {
    alignItems: "center",
    gap: 20,
  },
  logoContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  shieldEmblem: {
    width: 90,
    height: 90,
    borderRadius: 28,
    backgroundColor: "#F8CB46",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.25)",
    shadowColor: "#F8CB46",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  textContainer: {
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    fontSize: 34,
    fontFamily: Typography.fontFamily.bold,
    color: "#FFFFFF",
    letterSpacing: 8,
    textAlign: "center",
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  subLine: {
    width: 24,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  tagline: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700Light,
    letterSpacing: 3,
    textAlign: "center",
  },
  bottomBlock: {
    position: "absolute",
    bottom: 48,
    alignItems: "center",
    gap: 12,
    width: SCREEN_WIDTH - 64,
  },
  bottomTagline: {
    fontSize: 12,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255, 255, 255, 0.6)",
    textAlign: "center",
  },
  progressTrack: {
    width: 140,
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#F8CB46",
    borderRadius: 2,
  },
  tapPrompt: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255, 255, 255, 0.35)",
    marginTop: 4,
  },
});
