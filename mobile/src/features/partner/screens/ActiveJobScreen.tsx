// ─── Sahayak — Active Job Screen (Partner) ───────────────────────────────────
// Persistent map + route + compact bottom sheet, but every value on the sheet
// comes from GET /jobs/{id}: owner contact, pickup coordinates, vehicle
// registration, service and quote. The only way this screen advances to
// in_progress is POST /jobs/{id}/start with the owner's code, and completion
// requires the partner to enter the amount actually charged.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar, Animated, Linking, Pressable, TextInput, ActivityIndicator, Keyboard, ScrollView } from "react-native";
import { showDialog } from "../../../components/ui/AppDialog";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import RealMap from "../../../components/map/RealMap";
import { jobsApi } from "../../../services/api/jobs";
import type { BackendJob } from "../../../services/api/jobs";
import type { PartnerStackParamList } from "../../../types";
import { inr, serviceMetaFor } from "../partnerFormat";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "ActiveJob">;
type Route = RouteProp<PartnerStackParamList, "ActiveJob">;

type Step = "en_route" | "arrived" | "in_progress";

const errorCodeOf = (err: any): string | undefined =>
  err?.response?.data?.error?.code;

export default function ActiveJobScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const jobId = route.params?.jobId;

  const [job, setJob] = useState<BackendJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The backend status is the source of truth; `arrived` is a purely local
  // waypoint between en_route and submitting the code.
  const [step, setStep] = useState<Step>("en_route");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const otpRefs = useRef<(React.ElementRef<typeof TextInput> | null)[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [finalAmount, setFinalAmount] = useState("");
  const amountSeeded = useRef(false);
  const enRouteSynced = useRef(false);
  const [partnerLocation, setPartnerLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const slideAnim = useRef(new Animated.Value(100)).current;
  // The start-code boxes and the amount field sit at the bottom of the sheet;
  // without lifting it, the number pad covers exactly what is being typed.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const loadJob = useCallback(
    async (showSpinner: boolean) => {
      if (!jobId) {
        setLoading(false);
        setLoadError(
          "No job was selected. Open the job from your dashboard or an incoming offer."
        );
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const data = await jobsApi.getJob(jobId);
        setJob(data);
        setLoadError(null);
        if (data.status === "in_progress") {
          setStep("in_progress");
        } else if (data.status === "assigned" || data.status === "partner_en_route") {
          setStep((current) => (current === "arrived" ? current : "en_route"));
        }
      } catch {
        if (showSpinner) {
          setLoadError(
            "Sahayak could not load this job. Check your connection and retry."
          );
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [jobId]
  );

  useEffect(() => {
    void loadJob(true);
  }, [loadJob]);

  // A quiet refresh keeps cancellation and owner-side changes visible without
  // flashing a spinner over a screen the mechanic is actively using.
  useEffect(() => {
    const interval = setInterval(() => void loadJob(false), 20000);
    return () => clearInterval(interval);
  }, [loadJob]);

  // Accepting an offer leaves the assignment at `assigned`; opening this screen
  // is the partner's signal that they are on the way. The transition is written
  // to the backend once, and a failure is surfaced instead of pretending.
  useEffect(() => {
    if (!job || job.status !== "assigned" || enRouteSynced.current) return;
    enRouteSynced.current = true;
    jobsApi
      .updateJobStatus(job.id, "partner_en_route")
      // The response is a confirmation, not the job: keep every field we
      // already have and take only the new status.
      .then((updated) => setJob((prev) => (prev ? { ...prev, status: updated.status } : prev)))
      .catch(() => {
        setActionError(
          "Could not tell Sahayak you are en route. The job is still assigned to you; stop and retry from the dashboard if this persists."
        );
      });
  }, [job]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [step, slideAnim]);

  useEffect(() => {
    if (step !== "in_progress" || amountSeeded.current) return;
    amountSeeded.current = true;
    if (job?.price_estimate != null) {
      setFinalAmount(String(Math.round(Number(job.price_estimate))));
    }
  }, [step, job]);

  // The partner's own position for the route canvas. Failure is not fatal: the
  // pickup point and job details are still real, the partner pin just stays off.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) {
          setPartnerLocation({
            latitude: last.coords.latitude,
            longitude: last.coords.longitude,
          });
        }
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setPartnerLocation({
            latitude: fresh.coords.latitude,
            longitude: fresh.coords.longitude,
          });
        }
      } catch {
        // Location is optional chrome here; the sheet remains fully usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickup =
    job?.pickup_lat != null && job?.pickup_lng != null
      ? { latitude: Number(job.pickup_lat), longitude: Number(job.pickup_lng) }
      : null;

  const meta = serviceMetaFor(job?.service_code);

  const handleNavigate = () => {
    if (!pickup) {
      showDialog(
        "Pickup coordinates unavailable",
        "This job does not include a map position. Call the customer and confirm the address before driving."
      );
      return;
    }
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${pickup.latitude},${pickup.longitude}`
    );
  };

  const handleOtpChange = (text: string, idx: number) => {
    const digit = text.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 3) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpBackspace = (idx: number) => {
    if (!otp[idx] && idx > 0) {
      const next = [...otp];
      next[idx - 1] = "";
      setOtp(next);
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerifyStartCode = async () => {
    if (!job) return;
    const code = otp.join("");
    if (code.length !== 4) {
      showDialog(
        "Incomplete code",
        "Enter the 4-digit start code shown on the customer's screen."
      );
      return;
    }
    setVerifying(true);
    setActionError(null);
    try {
      const updated = await jobsApi.startJob(job.id, code);
      Keyboard.dismiss();
      setJob((prev) => (prev ? { ...prev, status: updated.status } : prev));
      setStep("in_progress");
    } catch (err: any) {
      const codeName = errorCodeOf(err);
      if (codeName === "INVALID_START_CODE") {
        setOtp(["", "", "", ""]);
        otpRefs.current[0]?.focus();
        showDialog(
          "Incorrect start code",
          "That code does not match this job. Ask the customer to read the 4 digits on their screen again."
        );
      } else {
        showDialog(
          "Could not start the job",
          "Sahayak did not confirm the start code. The job is still active and has not been marked in progress. Check your connection and retry."
        );
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleComplete = async () => {
    if (!job) return;
    const amount = Number(finalAmount);
    if (!finalAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      showDialog(
        "Enter the final amount",
        "Type the amount actually charged for this rescue. Sahayak records this as the customer's final price."
      );
      return;
    }
    setCompleting(true);
    setActionError(null);
    try {
      await jobsApi.updateJobStatus(job.id, "completed", Math.round(amount));
      nav.replace("PartnerJobDone", { jobId: job.id });
    } catch (err: any) {
      const codeName = errorCodeOf(err);
      if (codeName === "INVALID_STATUS_TRANSITION") {
        showDialog(
          "Job cannot be completed",
          "The job is no longer in progress. Refresh the job to see its current state."
        );
        void loadJob(true);
      } else {
        showDialog(
          "Could not complete the job",
          "Sahayak did not save the completion. The job remains in progress. Check your connection and retry."
        );
      }
    } finally {
      setCompleting(false);
    }
  };

  const renderMap = () => {
    // Before the job has loaded there is nothing to say about coordinates yet;
    // claiming "not shared" here flashed a false message on every accept.
    if (!job) {
      return <View style={styles.mapLoading} />;
    }
    if (!pickup) {
      return (
        <View style={styles.mapFallback}>
          <Ionicons name="map-outline" size={32} color={Colors.textSecondary} />
          <Text style={styles.mapFallbackText}>
            Pickup coordinates were not shared for this job. Use the address and
            call button below.
          </Text>
        </View>
      );
    }
    return (
      <View style={StyleSheet.absoluteFill}>
        <RealMap userLocation={pickup} partnerLocation={partnerLocation} showRoute={!!partnerLocation} />
        <View style={styles.mapOverlay} pointerEvents="box-none">
          <Pressable
            onPress={() => nav.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.mapBack}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <View style={styles.mapStatus}>
            <View style={[styles.mapStatusDot, step === "in_progress" && { backgroundColor: Colors.success }]} />
            <Text style={styles.mapStatusText}>
              {step === "in_progress"
                ? "Service in progress"
                : step === "arrived"
                ? "Arrived at pickup"
                : "On the way to pickup"}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            style={styles.mapBack}
            onPress={handleNavigate}
            accessibilityRole="button"
            accessibilityLabel="Open directions in maps"
          >
            <Ionicons name="navigate" size={20} color={Colors.brand700} />
          </Pressable>
        </View>
      </View>
    );
  };

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.stateCard}>
          <ActivityIndicator size="small" color={Colors.brand700} />
          <Text style={styles.stateText}>Loading this job…</Text>
        </View>
      );
    }
    if (loadError) {
      return (
        <View style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={30} color={Colors.textSecondary} />
          <Text style={styles.stateTitle}>Job unavailable</Text>
          <Text style={styles.stateText}>{loadError}</Text>
          <Button
            label="Retry"
            onPress={() => void loadJob(true)}
            variant="primary"
            fullWidth
            style={{ marginTop: Spacing.sm }}
          />
          <Button
            label="Back to dashboard"
            onPress={() => nav.goBack()}
            variant="ghost"
            fullWidth
          />
        </View>
      );
    }
    if (!job) {
      return (
        <View style={styles.stateCard}>
          <Ionicons name="document-outline" size={30} color={Colors.textSecondary} />
          <Text style={styles.stateTitle}>No job selected</Text>
          <Text style={styles.stateText}>
            Open an accepted job from your dashboard to see its details.
          </Text>
        </View>
      );
    }
    if (job.status === "cancelled") {
      return (
        <View style={styles.stateCard}>
          <Ionicons name="close-circle-outline" size={30} color={Colors.error} />
          <Text style={styles.stateTitle}>Job cancelled</Text>
          <Text style={styles.stateText}>
            This rescue was cancelled and cannot be started or completed. You do
            not need to travel to the pickup.
          </Text>
          <Button
            label="Back to dashboard"
            onPress={() => nav.popToTop()}
            variant="primary"
            fullWidth
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      );
    }
    if (job.status === "completed") {
      return (
        <View style={styles.stateCard}>
          <Ionicons name="checkmark-circle-outline" size={30} color={Colors.success} />
          <Text style={styles.stateTitle}>Job already completed</Text>
          <Text style={styles.stateText}>
            Final amount: {inr(job.price_final)}. This job is closed.
          </Text>
          <Button
            label="View summary"
            onPress={() => nav.replace("PartnerJobDone", { jobId: job.id })}
            variant="primary"
            fullWidth
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      );
    }

    return (
      <>
        {actionError ? (
          <TouchableOpacity
            style={styles.errorBanner}
            onPress={() => setActionError(null)}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={15} color={Colors.error} />
            <Text style={styles.errorBannerText}>{actionError}</Text>
            <Text style={styles.errorBannerDismiss}>Dismiss</Text>
          </TouchableOpacity>
        ) : null}

        {/* Identity block + compact call/message actions */}
        <View style={styles.identityRow}>
          <View style={styles.customerAvatar}>
            <Ionicons name="person" size={20} color={Colors.textSecondary} />
          </View>
          <View style={styles.customerMeta}>
            <Text style={styles.customerName}>
              {job.owner_name ?? "Customer"}
            </Text>
            <Text style={styles.customerAddress} numberOfLines={1}>
              {job.pickup_address_text}
            </Text>
          </View>

          {job.owner_phone ? (
            <View style={styles.iconRow}>
              <TouchableOpacity
                style={styles.circleActionBtn}
                onPress={() => void Linking.openURL(`tel:${job.owner_phone}`)}
                accessibilityRole="button"
                accessibilityLabel="Call customer"
              >
                <Ionicons name="call" size={17} color={Colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.circleActionBtn}
                onPress={() => void Linking.openURL(`sms:${job.owner_phone}`)}
                accessibilityRole="button"
                accessibilityLabel="Message customer"
              >
                <Ionicons name="chatbubble-ellipses" size={17} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Vehicle + service, both backend fields */}
        <View style={styles.vehicleSubCard}>
          <View style={styles.vehicleIconCircle}>
            <Ionicons name={meta.icon as any} size={18} color={meta.color} />
          </View>
          <View style={styles.vehicleDetails}>
            <Text style={styles.vehicleModel}>
              {job.vehicle_number ?? "Registration not provided"}
            </Text>
            <Text style={styles.vehicleSubtext} numberOfLines={1}>
              {job.service_name ?? job.service_code ?? "Service details unavailable"}
            </Text>
          </View>
          {job.price_estimate != null ? (
            <View style={styles.plateTag}>
              <Text style={styles.plateText}>{inr(job.price_estimate)}</Text>
            </View>
          ) : null}
        </View>

        {job.issue_description ? (
          <Text style={styles.issueText} numberOfLines={2}>
            “{job.issue_description}”
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {job.price_estimate != null ? (
            <View style={styles.metaItem}>
              <Ionicons name="pricetag-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.metaText}>Owner's quote {inr(job.price_estimate)}</Text>
            </View>
          ) : null}
          {job.current_assignment?.estimated_arrival_min != null ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.metaText}>
                {job.current_assignment.estimated_arrival_min} min ETA
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── En route: navigate, then confirm arrival ── */}
        {step === "en_route" && (
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
              label="Arrived at location"
              onPress={() => setStep("arrived")}
              variant="primary"
              size="md"
              fullWidth={false}
              style={{ flex: 1.5 }}
            />
          </View>
        )}

        {/* ── Arrived: owner's start code is the only door to in_progress ── */}
        {step === "arrived" && (
          <View style={styles.otpContainer}>
            <View style={styles.otpHeader}>
              <Ionicons name="shield-checkmark" size={18} color={Colors.brand700} />
              <Text style={styles.otpHeaderTitle}>CUSTOMER START CODE</Text>
            </View>
            <Text style={styles.otpSubtitle}>
              Ask the customer for the 4 digits shown on their tracking screen.
              Their code is checked by Sahayak, not stored on this phone.
            </Text>

            <View style={styles.otpBoxesRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(r) => {
                    otpRefs.current[i] = r;
                  }}
                  style={[styles.otpBox, digit ? styles.otpBoxFilled : {}]}
                  value={digit}
                  onChangeText={(t) => handleOtpChange(t, i)}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === "Backspace") handleOtpBackspace(i);
                  }}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                  editable={!verifying}
                />
              ))}
            </View>

            <Button
              label={verifying ? "Checking…" : "Verify & start service"}
              onPress={handleVerifyStartCode}
              loading={verifying}
              disabled={verifying}
              variant="primary"
              size="md"
              fullWidth
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        )}

        {/* ── In progress: collect the real amount before closing ── */}
        {step === "in_progress" && (
          <View style={styles.inProgressContainer}>
            <View style={styles.verifiedRow}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.brand700} />
              <Text style={styles.verifiedText}>Code verified · Work underway</Text>
            </View>

            <Text style={styles.amountLabel}>Final amount charged</Text>
            <View style={styles.amountRow}>
              <Text style={styles.amountCurrency}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={finalAmount}
                onChangeText={(t) => setFinalAmount(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                editable={!completing}
              />
            </View>
            <Text style={styles.amountHint}>
              Enter what you actually charged. The customer sees this as the final price.
            </Text>

            <Button
              label={completing ? "Saving…" : "Mark complete"}
              onPress={handleComplete}
              loading={completing}
              disabled={completing}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {renderMap()}

      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }] },
          !pickup && styles.sheetNoMap,
          keyboardHeight > 0 && { bottom: keyboardHeight, paddingBottom: Spacing.md },
        ]}
      >
        <View style={styles.sheetHandle} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.sm }}
          bounces={false}
        >
          {renderBody()}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapOverlay: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  mapBack: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 4 },
  mapStatus: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 14, minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, elevation: 4 },
  mapStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand700 },
  mapLoading: { flex: 1, backgroundColor: "#EEF2F6" },
  mapStatusText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#0F172A" },
  container: { flex: 1, backgroundColor: "#E2E8F0" },
  map: { ...(StyleSheet.absoluteFill as object) },
  mapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: 10,
    backgroundColor: "#F1F5F9",
  },
  mapFallbackText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  myLocBtn: {
    position: "absolute",
    right: Spacing.lg,
    bottom: 340,
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
    maxHeight: "78%",
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
  sheetNoMap: { maxHeight: "92%" },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },

  stateCard: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: 6,
  },
  stateTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  stateText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  errorBannerText: {
    flex: 1,
    fontSize: Typography.fontSize.xs,
    lineHeight: 15,
    fontFamily: Typography.fontFamily.medium,
    color: "#B91C1C",
  },
  errorBannerDismiss: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.bold,
    color: "#B91C1C",
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
  customerMeta: { flex: 1 },
  customerName: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  customerAddress: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  iconRow: { flexDirection: "row", gap: 8 },
  circleActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  vehicleDetails: { flex: 1 },
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
    letterSpacing: 0.3,
  },

  issueText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    fontStyle: "italic",
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.base },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textSecondary,
  },

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
  otpHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
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
    lineHeight: 17,
  },
  otpBoxesRow: { flexDirection: "row", gap: 12, marginVertical: Spacing.xs },
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
    backgroundColor: "#F0FDFA",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.brand700Light,
    padding: Spacing.md,
    marginTop: 2,
    gap: 6,
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
  amountLabel: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: Spacing.xs,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: Colors.brand700,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  amountCurrency: {
    fontSize: Typography.fontSize.xl,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    height: 52,
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  amountHint: {
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  enRouteBtnsRow: { flexDirection: "row", gap: Spacing.sm, marginTop: 4 },
});
