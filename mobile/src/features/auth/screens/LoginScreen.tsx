// ─── Sahayak: sign in ─────────────────────────────────────────────────────────
// Phone number → 6-digit SMS code → (new owners) name. The role toggle only
// decides where a brand-new account is sent; an existing account always lands
// where the backend says it belongs (GET /auth/me), never where it tapped.
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Radius, Spacing } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import LogoMark from "../../../components/brand/LogoMark";
import { identityService } from "../../../services/identity";
import { usersApi } from "../../../services/api/users";
import { partnerApi } from "../../../services/api/partner";
import { servicesApi, type MobileCatalogService } from "../../../services/api/services";
import { Chip } from "../../../components/ui/kit";
import { IS_SUPABASE_CONFIGURED, sendPhoneOtp, toE164, verifyPhoneOtp } from "../../../services/supabase";
import { appRoleFor, useAuthStore } from "../../../store/authStore";
import type { UserRole } from "../../../types";
import { WEB_URL } from "../../../constants";

type Step = "phone" | "otp" | "name" | "partner";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

// Dev builds only: the test number configured in Supabase's phone provider.
const DEV_PHONE: Record<UserRole, string> = { owner: "9000000901", partner: "9000000902" };

export default function LoginScreen() {
  const { setUser, setToken, logout } = useAuthStore();
  const [role, setRole] = useState<UserRole>("owner");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState(__DEV__ ? DEV_PHONE.owner : "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<"towing" | "mechanical" | null>(null);
  const [catalog, setCatalog] = useState<MobileCatalogService[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const codeInput = useRef<React.ElementRef<typeof TextInput>>(null);
  const lastTried = useRef<string | null>(null);
  const token = useRef<string | null>(null);

  const e164 = toE164("+91", phone);
  const phoneOk = phone.replace(/\D/g, "").length === 10;

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const switchRole = (next: UserRole) => {
    setRole(next);
    setError(null);
    if (__DEV__) setPhone(DEV_PHONE[next]);
  };

  const sendCode = async () => {
    if (!phoneOk) {
      setError("Enter your 10-digit mobile number.");
      return;
    }
    if (!IS_SUPABASE_CONFIGURED) {
      setError("Sign-in is not configured in this build.");
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await sendPhoneOtp(e164);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message ?? "Could not send the code. Try again.");
      return;
    }
    setCode("");
    lastTried.current = null;
    setResendIn(RESEND_SECONDS);
    setStep("otp");
    setTimeout(() => codeInput.current?.focus(), 150);
  };

  const resend = async () => {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await sendPhoneOtp(e164);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message ?? "Could not send a new code. Try again.");
      return;
    }
    setCode("");
    lastTried.current = null;
    setResendIn(RESEND_SECONDS);
  };

  const finishSignIn = async (accessToken: string, displayName?: string) => {
    const resolution = await identityService.resolve();
    switch (resolution.kind) {
      case "registered":
        setUser(
          {
            id: resolution.identity.id,
            phone: e164,
            role: appRoleFor(resolution.identity.role),
            name: displayName ?? (resolution.identity.role === "partner" ? "Service partner" : "Vehicle owner"),
          },
          accessToken
        );
        return;
      case "needs-signup":
        // The token is good; there is just no profile behind it yet.
        setStep(role === "partner" ? "partner" : "name");
        return;
      case "needs-linking":
        setError(
          "A Sahayak profile is already registered with this number but is not yet linked to this login. Ask the Sahayak team to finish linking it."
        );
        setStep("phone");
        return;
      default:
        setError(resolution.message || "Signed in, but we could not load your profile. Try again.");
        setStep("phone");
    }
  };

  const verify = async (digits: string) => {
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyPhoneOtp(e164, digits);
      if (!verified.ok || !verified.accessToken) {
        setError(verified.message ?? "That code did not work. Check it and try again.");
        return;
      }
      token.current = verified.accessToken;
      // Stored before the next call, because that call needs it as its bearer.
      setToken(verified.accessToken);
      await finishSignIn(verified.accessToken);
    } finally {
      setBusy(false);
    }
  };

  // Auto-submit on the sixth digit, once per distinct code.
  useEffect(() => {
    if (step !== "otp" || code.length !== OTP_LENGTH || busy || lastTried.current === code) return;
    lastTried.current = code;
    void verify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, busy]);

  const register = async () => {
    const clean = name.trim();
    if (clean.length < 2) {
      setError("Enter your name.");
      return;
    }
    if (!token.current) {
      setError("Your session expired. Please sign in again.");
      setStep("phone");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await usersApi.createOwner(clean, e164);
      await finishSignIn(token.current, clean);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message;
      setError(msg ?? "We could not create your account. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== "partner" || catalog.length > 0) return;
    servicesApi.listServices().then(setCatalog).catch(() => setError("We could not load the list of services. Go back and try again."));
  }, [step, catalog.length]);

  const registerPartner = async () => {
    const clean = name.trim();
    if (clean.length < 2) return setError("Enter your name or business name.");
    if (!category) return setError("Choose your main work.");
    if (chosen.length === 0) return setError("Choose at least one service.");
    if (!token.current) {
      setError("Your session expired. Please sign in again.");
      setStep("phone");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await partnerApi.register(clean, e164, category);
      await partnerApi.linkAuth(created.id);
      await partnerApi.setServices(created.id, chosen).catch(() => undefined);
      await finishSignIn(token.current, clean);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? "We could not register you. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === "otp" || step === "name") setStep("phone");
    if (step === "partner") {
      logout();
      setStep("phone");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            {step === "phone" ? (
              <View style={styles.brand}>
                <LogoMark size={36} />
                <Text style={styles.brandText}>Sahayak</Text>
              </View>
            ) : (
              <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
                <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
              </Pressable>
            )}
          </View>

          {step === "phone" && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Get help on the road
              </Text>
              <Text style={styles.sub}>Sign in with your mobile number. No password needed.</Text>

              <View style={styles.seg} accessibilityRole="radiogroup">
                {(["owner", "partner"] as const).map((r) => {
                  const on = role === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => switchRole(r)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[styles.segBtn, on && styles.segOn]}
                    >
                      <Text style={[styles.segText, on && styles.segTextOn]}>{r === "owner" ? "Vehicle owner" : "Service partner"}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Mobile number</Text>
              <View style={[styles.phoneRow, error && !phoneOk ? { borderColor: Colors.error } : null]}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput
                  value={phone}
                  onChangeText={(t) => {
                    setError(null);
                    setPhone(t.replace(/\D/g, "").slice(0, 10));
                  }}
                  placeholder="98765 43210"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  maxLength={10}
                  accessibilityLabel="Mobile number"
                  style={styles.phoneInput}
                  onSubmitEditing={sendCode}
                />
              </View>

              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

              <View style={{ marginTop: Spacing.lg }}>
                <Button label="Send code" onPress={sendCode} loading={busy} disabled={!phoneOk} />
              </View>
              <Text style={styles.legal}>
                By continuing you agree to the Sahayak{" "}
                {WEB_URL ? (
                  <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(`${WEB_URL}/terms`)}>
                    terms of service
                  </Text>
                ) : (
                  "terms of service"
                )}{" "}
                and{" "}
                {WEB_URL ? (
                  <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}>
                    privacy policy
                  </Text>
                ) : (
                  "privacy policy"
                )}
                .
              </Text>
            </View>
          )}

          {step === "otp" && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Enter the code
              </Text>
              <Text style={styles.sub}>We sent a 6-digit code to +91 {phone}.</Text>

              <Pressable onPress={() => codeInput.current?.focus()} accessibilityLabel="Verification code" style={styles.otpRow}>
                {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                  <View key={i} style={[styles.otpBox, code[i] ? styles.otpFilled : null, i === code.length ? styles.otpActive : null, error ? { borderColor: Colors.error } : null]}>
                    <Text style={styles.otpDigit}>{code[i] ?? ""}</Text>
                  </View>
                ))}
                <TextInput
                  ref={codeInput}
                  value={code}
                  onChangeText={(t) => {
                    setError(null);
                    setCode(t.replace(/\D/g, "").slice(0, OTP_LENGTH));
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={OTP_LENGTH}
                  caretHidden
                  style={styles.hiddenInput}
                  accessibilityLabel="Verification code input"
                />
              </Pressable>

              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

              <View style={styles.otpFoot}>
                <Pressable onPress={back} accessibilityRole="button" style={styles.linkBtn}>
                  <Text style={styles.link}>Wrong number?</Text>
                </Pressable>
                <Pressable onPress={resend} disabled={resendIn > 0 || busy} accessibilityRole="button" style={styles.linkBtn}>
                  <Text style={[styles.link, resendIn > 0 && { color: Colors.textMuted }]}>{resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}</Text>
                </Pressable>
              </View>

              <View style={{ marginTop: Spacing.base }}>
                <Button label="Verify and continue" onPress={() => void verify(code)} loading={busy} disabled={code.length !== OTP_LENGTH} />
              </View>
            </View>
          )}

          {step === "name" && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Create your account
              </Text>
              <Text style={styles.sub}>Your number is verified. What should we call you?</Text>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                value={name}
                onChangeText={(t) => {
                  setError(null);
                  setName(t);
                }}
                placeholder="e.g. Asha Sharma"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                textContentType="name"
                autoComplete="name"
                accessibilityLabel="Full name"
                style={styles.nameInput}
                onSubmitEditing={register}
              />
              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <View style={{ marginTop: Spacing.lg }}>
                <Button label="Create account" onPress={register} loading={busy} />
              </View>
            </View>
          )}

          {step === "partner" && (
            <View>
              <Text style={styles.title} accessibilityRole="header">
                Register as a partner
              </Text>
              <Text style={styles.sub}>Tell us what you do. The Sahayak team verifies every partner before they receive jobs.</Text>

              <Text style={styles.label}>Your name or business name</Text>
              <TextInput
                value={name}
                onChangeText={(t) => {
                  setError(null);
                  setName(t);
                }}
                placeholder="e.g. Ravi Kumar"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                accessibilityLabel="Name or business name"
                style={styles.nameInput}
              />

              <Text style={styles.label}>Main work</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Chip label="Towing" selected={category === "towing"} onPress={() => setCategory("towing")} />
                <Chip label="Mechanic / on-site repair" selected={category === "mechanical"} onPress={() => setCategory("mechanical")} />
              </View>

              <Text style={styles.label}>Services you provide</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {catalog.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    selected={chosen.includes(s.code)}
                    onPress={() => setChosen((c) => (c.includes(s.code) ? c.filter((x) => x !== s.code) : [...c, s.code]))}
                  />
                ))}
              </View>
              <Text style={[styles.legal, { textAlign: "left" }]}>Towing needs your equipment verified by Sahayak before you are offered those jobs.</Text>

              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <View style={{ marginTop: Spacing.lg }}>
                <Button label="Register" onPress={registerPartner} loading={busy} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceWhite },
  scroll: { flexGrow: 1, padding: Spacing.screenHorizontal, paddingBottom: Spacing["3xl"] },
  topRow: { minHeight: 56, justifyContent: "center", marginBottom: Spacing.lg },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandText: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  backBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginLeft: -12 },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display, lineHeight: 36 },
  sub: { marginTop: Spacing.sm, fontSize: Typography.fontSize.md, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 23 },
  label: { marginTop: Spacing.xl, marginBottom: 8, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },

  seg: { marginTop: Spacing.xl, flexDirection: "row", padding: 4, borderRadius: Radius.md, backgroundColor: "#F1F5F9" },
  segBtn: { flex: 1, minHeight: 44, borderRadius: Radius.sm + 2, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  segText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary },
  segTextOn: { color: Colors.textPrimary },

  phoneRow: { flexDirection: "row", alignItems: "center", minHeight: 56, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, backgroundColor: Colors.surfaceWhite },
  prefix: { paddingHorizontal: 16, fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, borderRightWidth: 1, borderRightColor: Colors.border },
  phoneInput: { flex: 1, paddingHorizontal: 14, fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary, letterSpacing: 1 },
  nameInput: { minHeight: 56, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 16, fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary },
  error: { marginTop: Spacing.md, fontSize: Typography.fontSize.base, color: Colors.error, fontFamily: Typography.fontFamily.medium, lineHeight: 21 },
  legalLink: { textDecorationLine: "underline", color: Colors.textSecondary },
  legal: { marginTop: Spacing.base, textAlign: "center", fontSize: Typography.fontSize.xs, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular, lineHeight: 17 },

  otpRow: { marginTop: Spacing.xl, flexDirection: "row", gap: 8, justifyContent: "space-between" },
  otpBox: { flex: 1, height: 58, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceWhite },
  otpFilled: { borderColor: Colors.brand700 },
  otpActive: { borderColor: Colors.brand700, backgroundColor: Colors.brand700Muted },
  otpDigit: { fontSize: Typography.fontSize["3xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  hiddenInput: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: "transparent" },
  otpFoot: { marginTop: Spacing.sm, flexDirection: "row", justifyContent: "space-between" },
  linkBtn: { minHeight: 48, justifyContent: "center" },
  link: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  infoIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center", marginBottom: Spacing.base },
});
