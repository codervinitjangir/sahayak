// ─── Sahayak — Login Screen ───────────────────────────────────────────────────
// Owner default, Partner login in top-right corner
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { authApi } from "../../../services/api";
import { useAuthStore } from "../../../store/authStore";
import type { UserRole } from "../../../types";

type Step = "phone" | "otp";

export default function LoginScreen() {
  const [role, setRole] = useState<UserRole>("owner");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const { setUser } = useAuthStore();

  const isOwner = role === "owner";

  const toggleRole = () => {
    const next: UserRole = role === "owner" ? "partner" : "owner";
    setRole(next);
    setStep("phone");
    setPhone("");
    setOtp(["", "", "", "", "", ""]);
  };

  const handleSendOTP = async () => {
    if (phone.replace(/\D/g, "").length < 10) {
      Alert.alert("Invalid Number", "Please enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      await authApi.sendOTP(phone);
      setStep("otp");
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } catch {
      Alert.alert("Error", "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      Alert.alert("Incomplete OTP", "Please enter all 6 digits.");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.verifyOTP(phone, code, role);
      setUser(res.user, res.token);
    } catch {
      Alert.alert("Invalid OTP", "The code you entered is incorrect.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (text: string, idx: number) => {
    const digit = text.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) {
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

  const bgColor = isOwner ? Colors.primary : Colors.secondary;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bgColor }]} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={bgColor} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top Bar with Partner toggle ── */}
          <View style={styles.topBar}>
            {step === "otp" ? (
              <TouchableOpacity onPress={() => setStep("phone")} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={22} color={Colors.textWhite} />
              </TouchableOpacity>
            ) : (
              <View style={styles.backBtn} />
            )}
            <TouchableOpacity onPress={toggleRole} style={styles.roleToggle}>
              <Ionicons
                name={isOwner ? "construct-outline" : "car-outline"}
                size={15}
                color={Colors.textWhite}
              />
              <Text style={styles.roleToggleText}>
                {isOwner ? "Partner Login" : "Owner Login"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Hero Section ── */}
          <View style={styles.hero}>
            {/* Logo mark */}
            <View style={styles.logoMark}>
              <Ionicons
                name={isOwner ? "car-sport" : "construct"}
                size={36}
                color={isOwner ? Colors.primary : Colors.textWhite}
              />
            </View>
            <Text style={styles.appName}>Sahayak</Text>
            <Text style={styles.tagline}>
              {isOwner
                ? "24/7 Roadside Assistance\nat your fingertips"
                : "Earn on your schedule.\nHelp others on the road."}
            </Text>
          </View>

          {/* ── White Card ── */}
          <View style={styles.card}>
            {step === "phone" ? (
              <>
                <Text style={styles.cardTitle}>
                  {isOwner ? "Get Help Now" : "Partner Sign In"}
                </Text>
                <Text style={styles.cardSubtitle}>
                  We'll send a 6-digit OTP to verify your number
                </Text>

                {/* Phone input */}
                <View style={styles.inputWrap}>
                  <View style={styles.countryCode}>
                    <Text style={styles.countryText}>🇮🇳 +91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Mobile number"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={setPhone}
                    returnKeyType="done"
                    onSubmitEditing={handleSendOTP}
                  />
                </View>

                <Button
                  label="Send OTP"
                  onPress={handleSendOTP}
                  loading={loading}
                  variant={isOwner ? "primary" : "secondary"}
                  style={{ marginTop: Spacing.md }}
                />

                <Text style={styles.terms}>
                  By continuing, you agree to our{" "}
                  <Text style={styles.termsLink}>Terms of Service</Text> &{" "}
                  <Text style={styles.termsLink}>Privacy Policy</Text>
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Enter OTP</Text>
                <Text style={styles.cardSubtitle}>
                  Sent to +91 {phone}
                </Text>

                {/* OTP boxes */}
                <View style={styles.otpRow}>
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
                    />
                  ))}
                </View>

                <Button
                  label="Verify & Continue"
                  onPress={handleVerifyOTP}
                  loading={loading}
                  variant={isOwner ? "primary" : "secondary"}
                  style={{ marginTop: Spacing.base }}
                />

                <TouchableOpacity style={styles.resendRow} onPress={handleSendOTP}>
                  <Text style={styles.resendText}>
                    Didn't receive? <Text style={styles.resendLink}>Resend OTP</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* ── Features strip ── */}
          <View style={styles.features}>
            {(isOwner
              ? ["⚡ Fast Response", "✅ Verified Partners", "💰 Fair Pricing"]
              : ["💸 Daily Earnings", "🗓️ Flexible Hours", "🏆 Top Ratings"]
            ).map((f) => (
              <Text key={f} style={styles.featureItem}>{f}</Text>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  roleToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  roleToggleText: {
    color: Colors.textWhite,
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
  },

  hero: {
    alignItems: "center",
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing["2xl"],
    paddingHorizontal: Spacing.lg,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    backgroundColor: Colors.textWhite,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.base,
    ...(Shadows.floating as object),
  },
  appName: {
    fontSize: Typography.fontSize["4xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  tagline: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.regular,
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
    lineHeight: 26,
  },

  card: {
    backgroundColor: Colors.surfaceWhite,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius["2xl"],
    padding: Spacing.xl,
    ...(Shadows.floating as object),
  },
  cardTitle: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: Typography.fontSize.base,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },

  inputWrap: {
    flexDirection: "row",
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  countryCode: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.borderLight,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  countryText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  phoneInput: {
    flex: 1,
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },

  terms: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.md,
    lineHeight: 18,
    fontFamily: Typography.fontFamily.regular,
  },
  termsLink: {
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },

  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.base,
  },
  otpBox: {
    width: 46,
    height: 54,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  otpBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },

  resendRow: {
    alignItems: "center",
    marginTop: Spacing.md,
  },
  resendText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  resendLink: {
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },

  features: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xl,
  },
  featureItem: {
    fontSize: Typography.fontSize.xs,
    color: "rgba(255,255,255,0.85)",
    fontFamily: Typography.fontFamily.medium,
    textAlign: "center",
  },
});

