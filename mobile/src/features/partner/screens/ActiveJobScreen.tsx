// ─── Sahayak — Active Job Screen (Partner) ───────────────────────────────────
// Uber/Ola breakdown style: Persistent Map + Route + Compact Bottom Sheet with OTP verification
import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  Animated,
  Linking,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import SharedMapCanvas from "../../../components/map/SharedMapCanvas";
import { MOCK_INCOMING_OFFER } from "../../../services/api";
import type { PartnerStackParamList } from "../../../types";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "ActiveJob">;

const PARTNER_LOC = { latitude: 12.9756, longitude: 77.5906 };
const USER_LOC = { latitude: 12.9716, longitude: 77.5946 };

export default function ActiveJobScreen() {
  const nav = useNavigation<Nav>();
  const job = MOCK_INCOMING_OFFER.job;
  const slideAnim = useRef(new Animated.Value(100)).current;

  // Partner flow states: en_route -> arrived (enter 4-digit code) -> in_progress
  const [partnerStep, setPartnerStep] = useState<"en_route" | "arrived" | "in_progress">("arrived");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [partnerStep]);

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

  const handleOtpChange = (text: string, idx: number) => {
    const digit = text.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 3) {
      otpRefs.current[idx + 1]?.focus();
    }
  };

  const handleOtpBackspace = (idx: number) => {
    if (!otp[idx] && idx > 0) {
      const next = [...otp];
      next[idx - 1] = "";
      setOtp(next);
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerifyStartCode = () => {
    const code = otp.join("");
    if (code.length < 4) {
      Alert.alert("Incomplete Code", "Please enter the 4-digit start code provided by customer.");
      return;
    }
    // Any 4-digit code or "4821" accepts
    setPartnerStep("in_progress");
  };

  const handleDone = () => {
    nav.navigate("PartnerJobDone", { jobId: MOCK_INCOMING_OFFER.jobId });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Persistent Vector Map Canvas ── */}
      <SharedMapCanvas
        userLocation={USER_LOC}
        partnerLocation={PARTNER_LOC}
        showRoute={true}
        showBackButton={true}
        onBackPress={() => nav.goBack()}
        topStatusText={partnerStep === "in_progress" ? "Service In Progress" : "Job Active · 8 min"}
      />

      {/* ── My location button ── */}
      <TouchableOpacity style={styles.myLocBtn} onPress={handleNavigate}>
        <Ionicons name="navigate" size={20} color={Colors.brand700} />
      </TouchableOpacity>

      {/* ── Bottom Sheet with Dynamic Height & Content ── */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.sheetHandle} />

        {/* Identity block + Compact Icon-Row Actions */}
        <View style={styles.identityRow}>
          <View style={styles.customerAvatar}>
            <Ionicons name="person" size={20} color={Colors.textSecondary} />
          </View>
          <View style={styles.customerMeta}>
            <Text style={styles.customerName}>Arjun Sharma</Text>
            <Text style={styles.customerAddress} numberOfLines={1}>
              {job.pickupLocation.address}
            </Text>
          </View>

          {/* Compact Icon Row (Call + Message) */}
          <View style={styles.iconRow}>
            <TouchableOpacity
              style={styles.circleActionBtn}
              onPress={() => Linking.openURL("tel:+919876543210")}
              accessibilityRole="button"
              accessibilityLabel="Call Customer"
            >
              <Ionicons name="call" size={17} color={Colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.circleActionBtn}
              onPress={() => Linking.openURL("sms:+919876543210")}
              accessibilityRole="button"
              accessibilityLabel="Message Customer"
            >
              <Ionicons name="chatbubble-ellipses" size={17} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Distinct Bordered Vehicle Block ── */}
        <View style={styles.vehicleSubCard}>
          <View style={styles.vehicleIconCircle}>
            <Ionicons name="car" size={18} color={Colors.textPrimary} />
          </View>
          <View style={styles.vehicleDetails}>
            <Text style={styles.vehicleModel}>{job.vehicle?.model || "Hyundai Creta"}</Text>
            <Text style={styles.vehicleSubtext}>
              {job.vehicle?.type?.toUpperCase() || "SUV"} · Silver
            </Text>
          </View>
          <View style={styles.plateTag}>
            <Text style={styles.plateText}>{job.vehicle?.licensePlate || "DL 01 AB 1234"}</Text>
          </View>
        </View>

        {/* ── OTP CODE ENTRY BOXES (Partner Side - Visual Focal Point) ── */}
        {partnerStep === "arrived" && (
          <View style={styles.otpContainer}>
            <View style={styles.otpHeader}>
              <Ionicons name="shield-checkmark" size={18} color={Colors.brand700} />
              <Text style={styles.otpHeaderTitle}>CUSTOMER START CODE</Text>
            </View>
            <Text style={styles.otpSubtitle}>
              Ask customer for their 4-digit code to begin roadside assistance
            </Text>

            {/* 4 Large High-Contrast Entry Boxes */}
            <View style={styles.otpBoxesRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { otpRefs.current[i] = r; }}
                  style={[
                    styles.otpBox,
                    digit ? styles.otpBoxFilled : {},
                  ]}
                  value={digit}
                  onChangeText={(t) => handleOtpChange(t, i)}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === "Backspace") handleOtpBackspace(i);
                  }}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            <Button
              label="Verify & Start Service"
              onPress={handleVerifyStartCode}
              variant="primary"
              size="md"
              fullWidth
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        )}

        {/* ── Job In Progress Mode ── */}
        {partnerStep === "in_progress" && (
          <View style={styles.inProgressContainer}>
            <View style={styles.verifiedRow}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.brand700} />
              <Text style={styles.verifiedText}>Code Verified · Work Underway</Text>
            </View>
            <Button
              label="Mark Complete"
              onPress={handleDone}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        )}

        {/* ── En Route Actions ── */}
        {partnerStep === "en_route" && (
          <View style={styles.enRouteBtnsRow}>
            <Button
              label="Navigate"
              onPress={handleNavigate}
              variant="outline"
              size="md"
              icon={<Ionicons name="navigate" size={16} color={Colors.textPrimary} />}
              fullWidth={false}
              style={{ flex: 1 }}
            />
            <Button
              label="Arrived at Location"
              onPress={() => setPartnerStep("arrived")}
              variant="primary"
              size="md"
              fullWidth={false}
              style={{ flex: 1.5 }}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E2E8F0" },
  map: { ...StyleSheet.absoluteFill as object },

  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    zIndex: 10,
  },
  floatingBackButton: {
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
  topBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    gap: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.brand700,
  },
  statusPillText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },

  partnerPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1C",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.surfaceWhite,
  },
  userPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: Colors.brand700,
  },

  myLocBtn: {
    position: "absolute",
    right: Spacing.lg,
    bottom: 310,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    ...(Shadows.card as object),
    zIndex: 5,
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Platform.OS === "ios" ? 34 : Spacing.lg,
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderColor: Colors.border,
    ...(Shadows.card as object),
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },

  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  customerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  customerMeta: {
    flex: 1,
  },
  customerName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  customerAddress: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  iconRow: {
    flexDirection: "row",
    gap: 8,
  },
  circleActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  vehicleSubCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 10,
  },
  vehicleIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleDetails: {
    flex: 1,
  },
  vehicleModel: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  vehicleSubtext: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  plateTag: {
    backgroundColor: Colors.surfaceWhite,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  plateText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },

  // ── Prominent OTP Entry Styling ──
  otpContainer: {
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  otpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  otpHeaderTitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
    letterSpacing: 1,
  },
  otpSubtitle: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  otpBoxesRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: Spacing.xs,
  },
  otpBox: {
    width: 52,
    height: 60,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
    fontSize: 26,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  otpBoxFilled: {
    borderColor: Colors.brand700,
    backgroundColor: Colors.surfaceWhite,
  },

  inProgressContainer: {
    backgroundColor: "#FFFCF0",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.brand700Light,
    padding: Spacing.md,
    marginTop: 2,
  },
  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  verifiedText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
  },

  enRouteBtnsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: 4,
  },
});
