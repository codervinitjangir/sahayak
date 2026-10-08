// ─── Sahayak — Uber-Style Login Screen ──────────────────────────────────────────
// Step 2 in user sequence: Minimalist Uber mobile onboarding language:
// 1. "Enter your mobile number" with +91 country selector
// 2. Full-width high-contrast black CTA button ("Continue →")
// 3. Social login options (Google & Apple)
// 4. Quick 1-tap demo logins for instant testing (Owner & Partner)
// 5. 6-digit OTP verification with auto-focus inputs & pre-fill option
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
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Radius, Spacing } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { MOCK_USER_OWNER, MOCK_USER_PARTNER } from "../../../services/api";
import { identityService } from "../../../services/identity";
import {
  IS_SUPABASE_CONFIGURED,
  sendPhoneOtp,
  toE164,
  verifyPhoneOtp,
} from "../../../services/supabase";
import { appRoleFor, useAuthStore } from "../../../store/authStore";
import type { UserRole } from "../../../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type LoginStep = "phone" | "otp";

export default function LoginScreen() {
  const [role, setRole] = useState<UserRole>("owner");
  const [step, setStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("9876543210");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);

  const otpRefs = useRef<(TextInput | null)[]>([]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const { setUser, setToken, setDemoUser } = useAuthStore();

  const isOwner = role === "owner";

  const toggleRole = () => {
    const next: UserRole = role === "owner" ? "partner" : "owner";
    setRole(next);
    setStep("phone");
    setOtp(["", "", "", "", "", ""]);
  };

  const handleSendOTP = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      Alert.alert("Invalid Phone Number", "Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!IS_SUPABASE_CONFIGURED) {
      Alert.alert(
        "Sign-in not configured",
        "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env, then restart the dev server."
      );
      return;
    }
    setLoading(true);
    try {
      // A real code to a real number. This used to call a mock that returned
      // `{success: true}` without a network request, then pre-fill the boxes with
      // 123456 — so the screen reached "verified" whether or not anything had been
      // sent, and produced no token either way.
      const outcome = await sendPhoneOtp(toE164("+91", phone));
      if (!outcome.ok) {
        Alert.alert("Could not send code", outcome.message ?? "Please try again.");
        return;
      }
      setOtp(["", "", "", "", "", ""]);
      setStep("otp");
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      Alert.alert("Incomplete Code", "Please enter all 6 digits.");
      return;
    }
    setLoading(true);
    try {
      const verified = await verifyPhoneOtp(toE164("+91", phone), code);
      if (!verified.ok || !verified.accessToken) {
        // Previously this branch called handleQuickDemo(role), so a wrong code —
        // or a Supabase outage — signed the user in as a hardcoded mock profile.
        // A failed sign-in has to look like a failed sign-in.
        Alert.alert("Verification failed", verified.message ?? "That code did not work.");
        return;
      }

      // Stored before the next call, because that call needs it as its bearer.
      setToken(verified.accessToken);

      // The role toggle on the previous screen only seeded a phone number. What
      // this account actually *is* comes from our own tables, and only
      // GET /api/v1/auth/me knows — so a mechanic who tapped "Owner" still lands
      // in the partner screens.
      const resolution = await identityService.resolve();

      switch (resolution.kind) {
        case "registered":
          setUser(
            {
              ...(resolution.identity.role === "partner" ? MOCK_USER_PARTNER : MOCK_USER_OWNER),
              id: resolution.identity.id,
              phone: toE164("+91", phone),
              role: appRoleFor(resolution.identity.role),
            },
            verified.accessToken
          );
          return;

        case "needs-signup":
          // The token is good; there is simply no profile behind it yet. Mobile has
          // no registration screen, and POST /api/v1/users needs exactly this token
          // — so say what is missing rather than signing them into empty screens.
          Alert.alert(
            "Finish signing up",
            "This number is verified but has no Sahayak profile yet. Complete signup on the Sahayak web app, then sign in here."
          );
          return;

        case "needs-linking":
          // An unclaimed profile exists for this number. link-auth needs its id,
          // which this account has no way to learn — deliberately, since link-auth
          // binds on the verified phone claim and handing ids out would widen that.
          Alert.alert(
            "Account not linked",
            "A Sahayak profile is already registered with this number but is not yet linked to this login. Ask the Sahayak team to finish linking it."
          );
          return;

        default:
          Alert.alert(
            "Signed in, but…",
            resolution.message || "Could not load your profile. Please try again."
          );
          return;
      }
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

  const handleQuickDemo = (demoRole: UserRole) => {
    // Browses the mocked screens; does **not** sign anyone in. It used to pass
    // "mock_jwt_token" as a bearer, which the request interceptor would now put on
    // every call to a backend that verifies tokens against the project's JWKS.
    const mockUser = demoRole === "owner" ? MOCK_USER_OWNER : MOCK_USER_PARTNER;
    setDemoUser(mockUser);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top Header Navigation ── */}
          <View style={styles.topHeader}>
            {step === "otp" ? (
              <TouchableOpacity
                onPress={() => setStep("phone")}
                style={styles.circleBackBtn}
                accessibilityLabel="Back to phone input"
              >
                <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.logoBadgeSmall}>
                <Ionicons name="flash" size={16} color="#FFFFFF" />
                <Text style={styles.logoBadgeSmallText}>SAHAYAK</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={toggleRole}
              style={styles.roleSwitchPill}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isOwner ? "construct-outline" : "car-outline"}
                size={14}
                color={Colors.brand700}
              />
              <Text style={styles.roleSwitchText}>
                {isOwner ? "Partner Mode" : "Owner Mode"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Step 1: Phone Input (Uber Style) ── */}
          {step === "phone" ? (
            <View style={styles.bodyBlock}>
              <Text style={styles.uberTitle}>Enter your mobile number</Text>
              <Text style={styles.uberSubtitle}>
                {isOwner
                  ? "Get instant 24/7 roadside breakdown assistance"
                  : "Sign in to accept rescue offers and start earning"}
              </Text>

              {/* Phone Input Box */}
              <View style={styles.phoneInputRow}>
                <View style={styles.countryPickerPill}>
                  <Text style={styles.flagText}>🇮🇳</Text>
                  <Text style={styles.countryCodeText}>+91</Text>
                  <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
                </View>
                <TextInput
                  style={styles.phoneTextInput}
                  placeholder="Mobile number"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={setPhone}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOTP}
                  autoFocus={false}
                />
              </View>

              {/* Primary Continue Button */}
              <TouchableOpacity
                style={[
                  styles.uberPrimaryBtn,
                  phone.length >= 10 ? styles.uberPrimaryBtnActive : styles.uberPrimaryBtnDisabled,
                ]}
                onPress={handleSendOTP}
                activeOpacity={0.85}
                disabled={loading}
              >
                <Text style={styles.uberPrimaryBtnText}>
                  {loading ? "Sending Code..." : "Continue"}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Social Login Buttons */}
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => handleQuickDemo("owner")}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-google" size={18} color="#EA4335" />
                <Text style={styles.socialBtnText}>Continue with Google</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => handleQuickDemo("owner")}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-apple" size={20} color="#000000" />
                <Text style={styles.socialBtnText}>Continue with Apple</Text>
              </TouchableOpacity>

              {/* Quick 1-Tap Demo Testing Card */}
              <View style={styles.demoTestingCard}>
                <Text style={styles.demoCardTitle}>DEVELOPER QUICK LOGIN</Text>
                <View style={styles.demoButtonsRow}>
                  <TouchableOpacity
                    style={styles.demoPillBtn}
                    onPress={() => handleQuickDemo("owner")}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="car" size={14} color={Colors.brand700} />
                    <Text style={styles.demoPillText}>Login as Owner (Arjun)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.demoPillBtn, { borderColor: Colors.secondary }]}
                    onPress={() => handleQuickDemo("partner")}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="construct" size={14} color={Colors.secondary} />
                    <Text style={[styles.demoPillText, { color: Colors.secondary }]}>
                      Login as Partner (Ravi)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.disclaimerText}>
                By continuing, you agree to receive SMS notifications. Message and data rates may apply.
              </Text>
            </View>
          ) : (
            /* ── Step 2: 6-Digit OTP Verification (Uber Style) ── */
            <View style={styles.bodyBlock}>
              <Text style={styles.uberTitle}>Welcome back</Text>
              <Text style={styles.uberSubtitle}>
                Enter the 6-digit code sent to{"\n"}
                <Text style={{ fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary }}>
                  +91 {phone}
                </Text>
              </Text>

              {/* 6 Digit Input Boxes */}
              <View style={styles.otpGrid}>
                {otp.map((digit, idx) => (
                  <TextInput
                    key={idx}
                    ref={(ref) => {
                      otpRefs.current[idx] = ref;
                    }}
                    style={[
                      styles.otpBox,
                      digit ? styles.otpBoxFilled : null,
                    ]}
                    value={digit}
                    onChangeText={(t) => handleOtpChange(t, idx)}
                    onKeyPress={({ nativeEvent }) => {
                      if (nativeEvent.key === "Backspace") {
                        handleOtpBackspace(idx);
                      }
                    }}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    autoFocus={idx === 0}
                  />
                ))}
              </View>

              {/* Fills the fixed code that Supabase's *configured test numbers*
                  accept. It is still useful — those numbers bypass SMS entirely,
                  which is how the flow gets demoed without sending a message — but
                  it is no longer a way past verification: a real number will reject
                  this code, and the label says so rather than implying otherwise. */}
              <TouchableOpacity
                style={styles.prefillChip}
                onPress={() => setOtp(["1", "2", "3", "4", "5", "6"])}
                activeOpacity={0.8}
              >
                <Ionicons name="flash-outline" size={13} color={Colors.brand700} />
                <Text style={styles.prefillChipText}>Test numbers only: 123456</Text>
              </TouchableOpacity>

              {/* Primary Verify Button */}
              <TouchableOpacity
                style={[styles.uberPrimaryBtn, styles.uberPrimaryBtnActive]}
                onPress={handleVerifyOTP}
                activeOpacity={0.85}
                disabled={loading}
              >
                <Text style={styles.uberPrimaryBtnText}>
                  {loading ? "Verifying..." : "Verify & Continue"}
                </Text>
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Resend Code Link */}
              <View style={styles.resendRow}>
                <Text style={styles.resendSub}>Didn't receive code? </Text>
                <TouchableOpacity onPress={handleSendOTP}>
                  <Text style={styles.resendLink}>Resend SMS</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    marginBottom: 16,
  },
  logoBadgeSmall: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8CB46",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
    gap: 6,
  },
  logoBadgeSmallText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: "#FFFFFF",
    letterSpacing: 1.5,
  },
  circleBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  roleSwitchPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFCF0",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "#FEF6D8",
    gap: 6,
  },
  roleSwitchText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  bodyBlock: {
    gap: 16,
  },
  uberTitle: {
    fontSize: 26,
    fontFamily: Typography.fontFamily.bold,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.6,
  },
  uberSubtitle: {
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
    color: "#545454",
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  phoneInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  countryPickerPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  flagText: {
    fontSize: 18,
  },
  countryCodeText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  phoneTextInput: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  uberPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
    paddingVertical: 16,
    borderRadius: Radius.lg,
    gap: 10,
    marginTop: 8,
  },
  uberPrimaryBtnActive: {
    backgroundColor: "#000000",
  },
  uberPrimaryBtnDisabled: {
    backgroundColor: "#64748B",
  },
  uberPrimaryBtnText: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: "#FFFFFF",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textMuted,
  },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    gap: 10,
  },
  socialBtnText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  demoTestingCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
    marginTop: 8,
  },
  demoCardTitle: {
    fontSize: 10,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  demoButtonsRow: {
    gap: 8,
  },
  demoPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.brand700,
    paddingVertical: 10,
    borderRadius: Radius.md,
    gap: 8,
  },
  demoPillText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
  disclaimerText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 12,
  },

  // OTP Screen Styles
  otpGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 12,
  },
  otpBox: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    textAlign: "center",
    fontSize: 22,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  otpBoxFilled: {
    borderColor: Colors.brand700,
    backgroundColor: "#FFFCF0",
  },
  prefillChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFCF0",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "#FEF6D8",
    gap: 6,
  },
  prefillChipText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.brand700,
  },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  resendSub: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  resendLink: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.brand700,
  },
});
