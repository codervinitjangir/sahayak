// ─── Sahayak: owner request and tracking flow ─────────────────────────────────
// One real map under a bottom sheet that changes with the request:
//   details   → pickup, service, vehicle, notes, send
//   searching → matching in progress (leave and come back any time)
//   matched   → partner, start code, status
//   done      → completed (rate) or ended (cancelled / no partner)
// Nothing here is simulated: a request that does not reach the backend says so
// and stays on the details sheet.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
  Linking,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";

import { Colors, Typography, Radius, Spacing, Shadows } from "../../../constants/theme";
import type { LatLng, OwnerStackParamList, ServiceType } from "../../../types";
import Button from "../../../components/ui/Button";
import RealMap from "../../../components/map/RealMap";
import SafetyActions from "../../../components/ui/SafetyActions";
import { Chip, EmptyState, ErrorState, Skeleton, StatusChip, TERMINAL_STATUSES, type BackendJobStatus } from "../../../components/ui/kit";
import { jobsApi, type BackendJob } from "../../../services/api/jobs";
import { servicesApi, type MobileCatalogService } from "../../../services/api/services";
import { vehiclesApi, type MobileVehicle } from "../../../services/api/vehicles";
import { useJobStore } from "../../../store/jobStore";
import AddVehicleModal from "../../account/AddVehicleModal";
import { QK } from "../../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "OwnerFlow">;
type Phase = "details" | "searching" | "matched" | "done";

// Where the map looks before a fix exists. It is NEVER sent as a pickup.
const MAP_FALLBACK: LatLng = { latitude: 12.9716, longitude: 77.5946 };

// The backend codes the dispatch engine can serve, grouped for the chip row.
// A code missing here is hidden on purpose: offering a service we cannot dispatch
// is worse than omitting it.
const CODE_GROUP: Record<string, ServiceType> = {
  flatbed_towing: "towing",
  wheel_lift_towing: "towing",
  battery_jumpstart: "battery",
  flat_tyre: "tyre",
  fuel_delivery: "fuel",
  minor_repair: "mechanic",
};

const newIdempotencyKey = () => {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `job-${Date.now().toString(36)}-${r()}-${r()}`;
};

const PROGRESS: { status: BackendJobStatus[]; label: string }[] = [
  { status: ["requested", "matching"], label: "Request received" },
  { status: ["assigned"], label: "Partner assigned" },
  { status: ["partner_en_route"], label: "On the way" },
  { status: ["in_progress"], label: "Work started" },
  { status: ["completed"], label: "Completed" },
];

function progressIndex(status: string): number {
  const i = PROGRESS.findIndex((p) => p.status.includes(status as BackendJobStatus));
  return i < 0 ? 0 : i;
}

export default function OwnerHelpFlowScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<OwnerStackParamList, "OwnerFlow">>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { setStartCode } = useJobStore();

  const resumeJobId = route.params?.jobId ?? null;
  const preferredType = route.params?.serviceType;

  // ── Catalogue and garage: server state, no fallbacks ──
  const [catalog, setCatalog] = useState<MobileCatalogService[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [vehicles, setVehicles] = useState<MobileVehicle[]>([]);
  const [vehiclesState, setVehiclesState] = useState<"loading" | "ready" | "error">("loading");

  const loadCatalog = useCallback(() => {
    setCatalogState("loading");
    servicesApi
      .listServices()
      .then((items) => {
        setCatalog(items.filter((s) => CODE_GROUP[s.code]));
        setCatalogState("ready");
      })
      .catch(() => setCatalogState("error"));
  }, []);
  const loadVehicles = useCallback(() => {
    setVehiclesState("loading");
    vehiclesApi
      .fetchVehicles()
      .then((v) => {
        setVehicles(v);
        setVehiclesState("ready");
      })
      .catch(() => setVehiclesState("error"));
  }, []);
  useEffect(() => {
    loadCatalog();
    loadVehicles();
  }, [loadCatalog, loadVehicles]);

  // ── Draft ──
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [addressLabel, setAddressLabel] = useState("");
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [serviceCode, setServiceCode] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  // ── Active request ──
  const [phase, setPhase] = useState<Phase>(resumeJobId ? "searching" : "details");
  const [jobId, setJobId] = useState<string | null>(resumeJobId);
  const [job, setJob] = useState<BackendJob | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // ── Rating ──
  const [canRate, setCanRate] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Preselect the first service in the group the owner tapped on Home.
  useEffect(() => {
    if (serviceCode || catalog.length === 0) return;
    const match = preferredType ? catalog.find((s) => CODE_GROUP[s.code] === preferredType) : undefined;
    if (match) setServiceCode(match.code);
  }, [catalog, preferredType, serviceCode]);

  // A single vehicle is selected for the owner; several are a choice.
  useEffect(() => {
    if (!vehicleId && vehicles.length === 1) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);

  // ── Location ──
  const locate = useCallback(async (explicit: boolean) => {
    setLocating(true);
    setLocationNote(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocationNote("Location access is off. Allow it in settings, or drag the pin to where you are.");
        return;
      }
      // A first fix is often coarse (cell/Wi-Fi). Take it so the pin appears at once,
      // then listen for up to 10s and keep the most accurate reading.
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      setPickup({ latitude: first.coords.latitude, longitude: first.coords.longitude });
      setAccuracyM(first.coords.accuracy ?? null);
      let best = first.coords.accuracy ?? Infinity;
      if (best > 25) {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (p) => {
            const acc = p.coords.accuracy ?? Infinity;
            if (acc < best) {
              best = acc;
              setPickup({ latitude: p.coords.latitude, longitude: p.coords.longitude });
              setAccuracyM(acc);
            }
            if (acc <= 15) sub.remove();
          }
        );
        setTimeout(() => sub.remove(), 10000);
      }
    } catch {
      setLocationNote(
        explicit ? "Could not get a GPS fix. Drag the pin to where you are." : "Waiting for GPS. You can also drag the pin."
      );
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    if (!resumeJobId) void locate(false);
  }, [locate, resumeJobId]);

  // Human-readable label for the pin. Cosmetic: the coordinates are what dispatch uses.
  useEffect(() => {
    if (!pickup) return;
    let cancelled = false;
    Location.reverseGeocodeAsync(pickup)
      .then((res) => {
        if (cancelled) return;
        const a = res[0];
        setAddressLabel(a ? [a.name, a.street, a.district, a.city].filter(Boolean).join(", ") : "");
      })
      .catch(() => !cancelled && setAddressLabel(""));
    return () => {
      cancelled = true;
    };
  }, [pickup]);

  // ── Polling ──
  const applyJob = useCallback(
    (j: BackendJob) => {
      setJob(j);
      if (j.start_code) setStartCode(j.start_code);
      if (j.pickup_lat != null && j.pickup_lng != null) {
        setPickup({ latitude: j.pickup_lat, longitude: j.pickup_lng });
      }
      const s = j.status as BackendJobStatus;
      if (s === "requested" || s === "matching") setPhase("searching");
      else if (s === "assigned" || s === "partner_en_route" || s === "in_progress") setPhase("matched");
      else setPhase("done");
    },
    [setStartCode]
  );

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const j = await jobsApi.getJob(jobId);
        if (stopped) return;
        setPollFailed(false);
        applyJob(j);
        if (TERMINAL_STATUSES.includes(j.status as BackendJobStatus)) {
          stopped = true;
          if (id) clearInterval(id);
          void qc.invalidateQueries({ queryKey: QK.jobs });
        }
      } catch {
        // A transient failure is not a job failure; the next tick retries.
        if (!stopped) setPollFailed(true);
      }
    };
    void tick();
    id = setInterval(tick, 4000);
    return () => {
      stopped = true;
      if (id) clearInterval(id);
    };
  }, [jobId, applyJob, qc]);

  // Rating availability once complete.
  useEffect(() => {
    if (job?.status !== "completed" || !jobId) return;
    jobsApi
      .getRatings(jobId)
      .then((r) => setCanRate(r.can_rate))
      .catch(() => setCanRate(false));
  }, [job?.status, jobId]);

  // ── Actions ──
  const canSend = Boolean(pickup && serviceCode && vehicleId) && !sending;

  const send = async () => {
    if (!pickup || !serviceCode || !vehicleId) return;
    setSending(true);
    try {
      const created = await jobsApi.createJob(
        {
          vehicle_id: vehicleId,
          service_code: serviceCode,
          pickup_lat: pickup.latitude,
          pickup_lng: pickup.longitude,
          pickup_address_text: landmark.trim() || addressLabel || "Pinned location",
          issue_description: notes.trim() || undefined,
        },
        idempotencyKey.current
      );
      if (!created?.id) throw new Error("no id");
      idempotencyKey.current = newIdempotencyKey();
      setStartCode("");
      setJobId(created.id);
      setJob(created);
      setPhase("searching");
      void qc.invalidateQueries({ queryKey: QK.jobs });
    } catch {
      Alert.alert("Request not sent", "We could not reach Sahayak, so no partner has been requested. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const cancel = () =>
    Alert.alert(
      "Cancel this request?",
      job?.status === "in_progress" ? "Work has already started." : "Your partner will be told and the request will be closed.",
      [
        { text: "Keep request", style: "cancel" },
        {
          text: "Yes, cancel",
          style: "destructive",
          onPress: async () => {
            if (!jobId) return;
            setCancelling(true);
            try {
              await jobsApi.cancelJob(jobId, "Cancelled by owner");
            } catch (e: any) {
              if (e?.response?.status !== 409) {
                Alert.alert("Could not cancel", "Please try again.");
                setCancelling(false);
                return;
              }
            }
            setCancelling(false);
            void qc.invalidateQueries({ queryKey: QK.jobs });
            try {
              applyJob(await jobsApi.getJob(jobId));
            } catch {
              nav.goBack();
            }
          },
        },
      ]
    );

  const submitRating = async () => {
    if (!jobId || rating === 0) return;
    setRateBusy(true);
    setRateError(null);
    try {
      await jobsApi.submitRating(jobId, rating, comment.trim() || undefined);
      setRated(true);
    } catch (e: any) {
      if (e?.response?.status === 409) setRated(true);
      else setRateError("Could not submit your rating. Try again.");
    } finally {
      setRateBusy(false);
    }
  };

  const startAnother = () => {
    idempotencyKey.current = newIdempotencyKey();
    setJobId(null);
    setJob(null);
    setPhase("details");
    setServiceCode(null);
    setNotes("");
    setLandmark("");
    setRating(0);
    setComment("");
    setRated(false);
    setCanRate(false);
  };

  const goBack = () => {
    if (nav.canGoBack()) nav.goBack();
    else nav.navigate("OwnerHome");
  };

  // ── Derived ──
  const mapLocation = pickup ?? MAP_FALLBACK;
  const groups = useMemo(() => {
    const out: Record<string, MobileCatalogService[]> = {};
    for (const s of catalog) (out[s.category_name ?? "Services"] ||= []).push(s);
    return out;
  }, [catalog]);

  const assignment = job?.current_assignment;
  const partnerName = assignment?.partner_name ?? null;
  const partnerPhone = assignment?.partner_phone ?? null;
  const eta = assignment?.estimated_arrival_min;
  const showCode = Boolean(job?.start_code) && (job?.status === "assigned" || job?.status === "partner_en_route");
  const step = job ? progressIndex(job.status) : 0;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      <RealMap
        userLocation={mapLocation}
        partnerLocation={null}
        showRoute={false}
        showRadar={phase === "searching"}
        radarRadius={900}
        draggable={phase === "details"}
        onUserMarkerDragEnd={(c) => setPickup(c)}
      />

      {/* Floating back control */}
      <SafeAreaView style={styles.topBar} edges={["top"]} pointerEvents="box-none">
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" style={[styles.fab, Shadows.floating as object]}>
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        {phase === "details" && !pickup ? (
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>{locating ? "Finding your location…" : "Set your pickup: use GPS or drag the pin"}</Text>
          </View>
        ) : null}
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, Shadows.sheet as object, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
          <View style={styles.grabber} />

          {/* ───────── DETAILS ───────── */}
          {phase === "details" && (
            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.h1} accessibilityRole="header">
                Request roadside help
              </Text>

              {/* 1. Pickup */}
              <Text style={styles.label}>1. Pickup location</Text>
              <View style={styles.pickupRow}>
                <Ionicons name="location" size={22} color={pickup ? Colors.brand700 : Colors.textMuted} />
                <Text style={styles.pickupText} numberOfLines={2}>
                  {pickup ? addressLabel || `${pickup.latitude.toFixed(4)}, ${pickup.longitude.toFixed(4)}` : "Not set yet"}
                </Text>
                <Pressable onPress={() => void locate(true)} accessibilityRole="button" accessibilityLabel="Use my current location" style={styles.locBtn}>
                  <Text style={styles.locBtnText}>{locating ? "…" : "Use GPS"}</Text>
                </Pressable>
              </View>
              {locationNote ? <Text style={styles.note}>{locationNote}</Text> : pickup ? <Text style={styles.note}>{accuracyM != null ? `GPS accuracy about ${Math.round(accuracyM)} m. ` : ""}Drag the pin on the map to fine-tune.</Text> : null}
              <TextInput
                value={landmark}
                onChangeText={setLandmark}
                placeholder="Landmark (optional), e.g. near the blue petrol pump"
                placeholderTextColor={Colors.textMuted}
                accessibilityLabel="Landmark"
                style={styles.input}
              />

              {/* 2. Service */}
              <Text style={[styles.label, { marginTop: Spacing.lg }]}>2. What do you need?</Text>
              {catalogState === "loading" ? (
                <Skeleton height={48} />
              ) : catalogState === "error" ? (
                <ErrorState message="We could not load the list of services." onRetry={loadCatalog} />
              ) : catalog.length === 0 ? (
                <EmptyState icon="construct-outline" title="No services available" message="Please try again in a little while." />
              ) : (
                Object.entries(groups).map(([cat, items]) => (
                  <View key={cat} style={{ marginBottom: Spacing.sm }}>
                    <Text style={styles.group}>{cat}</Text>
                    <View style={styles.chips}>
                      {items.map((s) => (
                        <Chip key={s.id} label={s.name} selected={serviceCode === s.code} onPress={() => setServiceCode(s.code)} />
                      ))}
                    </View>
                  </View>
                ))
              )}

              {/* 3. Vehicle */}
              <Text style={[styles.label, { marginTop: Spacing.lg }]}>3. Which vehicle?</Text>
              {vehiclesState === "loading" ? (
                <Skeleton height={48} />
              ) : vehiclesState === "error" ? (
                <ErrorState message="We could not load your vehicles." onRetry={loadVehicles} />
              ) : (
                <View style={styles.chips}>
                  {vehicles.map((v) => (
                    <Chip
                      key={v.id}
                      icon={v.vehicle_type === "two_wheeler" ? "bicycle-outline" : "car-outline"}
                      label={`${v.make} ${v.model} · ${v.vehicle_number}`}
                      selected={vehicleId === v.id}
                      onPress={() => setVehicleId(v.id)}
                    />
                  ))}
                  <Chip icon="add" label={vehicles.length === 0 ? "Add your vehicle" : "Add another"} onPress={() => setAddVehicleOpen(true)} />
                </View>
              )}

              {/* 4. Notes */}
              <Text style={[styles.label, { marginTop: Spacing.lg }]}>4. Anything we should know? (optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Left rear tyre is flat, hazards are on."
                placeholderTextColor={Colors.textMuted}
                multiline
                accessibilityLabel="Notes"
                style={[styles.input, { minHeight: 76, textAlignVertical: "top", paddingTop: 12 }]}
              />

              <Text style={styles.priceNote}>Final price is confirmed when the job is completed.</Text>
              <View style={{ marginTop: Spacing.md }}>
                <Button label="Request help now" onPress={send} loading={sending} disabled={!canSend} icon={<Ionicons name="medkit-outline" size={22} color="#fff" />} />
                {!canSend && !sending ? (
                  <Text style={styles.needs}>
                    {!pickup ? "Set your pickup location" : !serviceCode ? "Choose what you need" : "Choose or add a vehicle"} to continue.
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          )}

          {/* ───────── SEARCHING ───────── */}
          {phase === "searching" && (
            <View>
              <View style={styles.searchHead}>
                <Pulse />
                <View style={{ flex: 1 }}>
                  <Text style={styles.h1}>Finding a partner</Text>
                  <Text style={styles.muted}>We are offering your request to the best-matched verified partners nearby.</Text>
                </View>
              </View>
              {job?.service_name ? (
                <Text style={styles.summary}>
                  {job.service_name}
                  {job.vehicle_number ? ` · ${job.vehicle_number}` : ""}
                </Text>
              ) : null}
              {pollFailed ? <Text style={styles.warn}>Connection is unstable. We will keep trying.</Text> : null}
              <Text style={styles.note}>You can leave this screen. Your request stays active and appears on Home.</Text>
              <View style={{ marginTop: Spacing.base, gap: Spacing.sm }}>
                <Button label="Cancel request" variant="outline" onPress={cancel} loading={cancelling} />
              </View>
              <View style={{ marginTop: Spacing.base }}>
                <SafetyActions jobId={job?.id} shareToken={job?.share_token} />
              </View>
            </View>
          )}

          {/* ───────── MATCHED ───────── */}
          {phase === "matched" && job && (
            <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
              <View style={styles.matchedHead}>
                <StatusChip status={job.status} />
                {eta != null && job.status !== "in_progress" ? <Text style={styles.eta}>About {eta} min</Text> : null}
              </View>

              <View style={styles.partnerCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(partnerName ?? "P").trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.partnerName}>{partnerName ?? "Your partner"}</Text>
                  <Text style={styles.muted}>
                    {assignment?.partner_rating != null
                      ? `${Number(assignment.partner_rating).toFixed(1)} rating · ${assignment.partner_rating_count ?? 0} ${assignment.partner_rating_count === 1 ? "job" : "jobs"}`
                      : "New partner"}
                  </Text>
                </View>
                {partnerPhone ? (
                  <Pressable
                    onPress={() => void Linking.openURL(`tel:${partnerPhone}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${partnerName ?? "your partner"}`}
                    style={styles.callBtn}
                  >
                    <Ionicons name="call" size={22} color="#fff" />
                  </Pressable>
                ) : null}
              </View>

              {showCode ? (
                <View style={styles.codeBox} accessible accessibilityLabel={`Your start code is ${job.start_code?.split("").join(" ")}`}>
                  <Text style={styles.codeLabel}>Your start code</Text>
                  <Text style={styles.code}>{job.start_code}</Text>
                  <Text style={styles.codeHelp}>Tell this to your partner only after they reach your vehicle. Work cannot start without it.</Text>
                </View>
              ) : null}

              {/* Progress */}
              <View style={styles.progress}>
                {PROGRESS.slice(0, 4).map((p, i) => {
                  const done = i <= step;
                  return (
                    <View key={p.label} style={styles.progressItem}>
                      <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={22} color={done ? Colors.brand700 : Colors.border} />
                      <Text style={[styles.progressText, done && { color: Colors.textPrimary, fontFamily: Typography.fontFamily.semiBold }]}>{p.label}</Text>
                    </View>
                  );
                })}
              </View>

              {pollFailed ? <Text style={styles.warn}>Connection is unstable. Showing the last update.</Text> : null}

              <View style={{ marginTop: Spacing.base }}>
                <SafetyActions jobId={job?.id} shareToken={job?.share_token} />
              </View>
              <View style={{ marginTop: Spacing.base }}>
                <Button label="Cancel request" variant="outline" onPress={cancel} loading={cancelling} />
              </View>
            </ScrollView>
          )}

          {/* ───────── DONE ───────── */}
          {phase === "done" && job && (
            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {job.status === "completed" ? (
                <>
                  <View style={styles.doneHead}>
                    <Ionicons name="checkmark-circle" size={44} color={Colors.success} />
                    <Text style={styles.h1}>Your request is complete</Text>
                    <Text style={styles.muted}>
                      {job.price_final != null ? `Final amount: ₹${Number(job.price_final)}` : "Your partner confirms the final amount with you."}
                    </Text>
                  </View>

                  {canRate && !rated ? (
                    <View>
                      <Text style={styles.label}>How was the service?</Text>
                      <View style={styles.stars} accessibilityRole="radiogroup">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Pressable
                            key={n}
                            onPress={() => setRating(n)}
                            accessibilityRole="radio"
                            accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
                            accessibilityState={{ selected: rating === n }}
                            style={styles.starBtn}
                          >
                            <Ionicons name={n <= rating ? "star" : "star-outline"} size={36} color={n <= rating ? "#F59E0B" : Colors.border} />
                          </Pressable>
                        ))}
                      </View>
                      <TextInput
                        value={comment}
                        onChangeText={setComment}
                        placeholder="Add a comment (optional)"
                        placeholderTextColor={Colors.textMuted}
                        multiline
                        accessibilityLabel="Comment"
                        style={[styles.input, { minHeight: 72, textAlignVertical: "top", paddingTop: 12 }]}
                      />
                      {rateError ? <Text style={styles.warn}>{rateError}</Text> : null}
                      <View style={{ marginTop: Spacing.md }}>
                        <Button label="Submit rating" onPress={submitRating} disabled={rating === 0} loading={rateBusy} />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.thanks}>
                      <Ionicons name="checkmark" size={18} color={Colors.success} />
                      <Text style={styles.thanksText}>Thanks for rating this service.</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.doneHead}>
                  <Ionicons
                    name={job.status === "no_match_found" ? "alert-circle" : "close-circle"}
                    size={44}
                    color={job.status === "no_match_found" ? Colors.warning : Colors.error}
                  />
                  <Text style={styles.h1}>{job.status === "no_match_found" ? "No partner available right now" : "Request cancelled"}</Text>
                  <Text style={[styles.muted, { textAlign: "center" }]}>
                    {job.status === "no_match_found"
                      ? "Every nearby verified partner was offered this job and none could take it. You can try again."
                      : "This request is closed. You can start a new one any time."}
                  </Text>
                </View>
              )}
              <View style={{ marginTop: Spacing.base, gap: Spacing.sm }}>
                <Button label={job.status === "completed" ? "Done" : "Request again"} onPress={job.status === "completed" ? goBack : startAnother} />
                {job.status !== "completed" ? <Button label="Back to home" variant="ghost" onPress={goBack} /> : null}
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>

      <AddVehicleModal
        visible={addVehicleOpen}
        onClose={() => setAddVehicleOpen(false)}
        onAdded={(v) => {
          setVehicles((prev) => [...prev, v]);
          setVehicleId(v.id);
        }}
      />
    </View>
  );
}

/** Soft expanding ring while a partner is being found. It only decorates. */
function Pulse() {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.8, duration: 1600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <View style={styles.pulseWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.pulseRing, { transform: [{ scale }], opacity }]} />
      <View style={styles.pulseCore}>
        <Ionicons name="radio" size={22} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, flexDirection: "row", alignItems: "center", gap: Spacing.md },
  fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.surfaceWhite, alignItems: "center", justifyContent: "center" },
  mapHint: { flex: 1, backgroundColor: Colors.surfaceWhite, borderRadius: Radius.full, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  mapHintText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },

  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: Colors.surfaceWhite, borderTopLeftRadius: Radius["2xl"], borderTopRightRadius: Radius["2xl"], paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: Spacing.md },

  h1: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.title },
  label: { marginTop: Spacing.base, marginBottom: Spacing.sm, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  group: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  muted: { fontSize: Typography.fontSize.base, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 21 },
  note: { marginTop: 6, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
  warn: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.warning, fontFamily: Typography.fontFamily.semiBold },
  needs: { marginTop: 8, textAlign: "center", fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium },
  priceNote: { marginTop: Spacing.base, textAlign: "center", fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },

  pickupRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, minHeight: 56, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  pickupText: { flex: 1, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary },
  locBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: Radius.full, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  locBtnText: { color: "#fff", fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold },
  input: { marginTop: Spacing.sm, minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.regular, color: Colors.textPrimary, backgroundColor: Colors.surfaceWhite },

  searchHead: { flexDirection: "row", alignItems: "center", gap: Spacing.base },
  summary: { marginTop: Spacing.md, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  pulseWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700 },
  pulseCore: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },

  matchedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.md },
  eta: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  partnerCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.brand700 },
  partnerName: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  callBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  codeBox: { marginTop: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.brand700, backgroundColor: Colors.surfaceWhite },
  codeLabel: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  code: { fontSize: 36, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: 10, marginVertical: 4 },
  codeHelp: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 19 },
  progress: { marginTop: Spacing.base, gap: Spacing.sm },
  progressItem: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: 28 },
  progressText: { fontSize: Typography.fontSize.base, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },

  doneHead: { alignItems: "center", gap: 8, paddingVertical: Spacing.base },
  stars: { flexDirection: "row", gap: 4, marginBottom: Spacing.sm },
  starBtn: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  thanks: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: Spacing.sm },
  thanksText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.success },
});
