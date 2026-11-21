// ─── Sahayak: owner request and tracking flow ─────────────────────────────────
// One real map under a bottom sheet that changes with the request:
//   details   → pickup, service, vehicle, notes, send
//   searching → matching in progress (leave and come back any time)
//   matched   → partner, start code, status
//   done      → completed (rate) or ended (cancelled / no partner)
// Nothing here is simulated: a request that does not reach the backend says so
// and stays on the details sheet.
import { useKeyboardHeight } from "../../../hooks/useKeyboardHeight";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, Linking, Animated, KeyboardAvoidingView, Platform, StatusBar, Keyboard, useWindowDimensions } from "react-native";
import { showDialog } from "../../../components/ui/AppDialog";
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
import OwnerJobSafeguards from "../../../components/ui/OwnerJobSafeguards";
import { RetryStopped, isNoSignal, sendWithRetry } from "../sendRetry";
import { Chip, EmptyState, ErrorState, Skeleton, StatusChip, TERMINAL_STATUSES, type BackendJobStatus } from "../../../components/ui/kit";
import { jobsApi, type BackendJob, type SearchStatus } from "../../../services/api/jobs";
import { servicesApi, type MobileCatalogService } from "../../../services/api/services";
import { vehiclesApi, type MobileVehicle } from "../../../services/api/vehicles";
import { useJobStore } from "../../../store/jobStore";
import AddVehicleModal from "../../account/AddVehicleModal";
import { QK } from "../../shared/ownerData";
import SlotPicker from "../components/SlotPicker";
import JobChatModal from "../contact/JobChatModal";
import { isActiveStatus, useJobChat, useShareOwnerLocation } from "../contact/useJobContact";
import ServiceTiles from "../components/ServiceTiles";
import IssuePhotoPicker from "../photos/IssuePhotoPicker";
import { OwnerIssuePhotos } from "../photos/JobPhotoStrip";
import { uploadIssuePhotos, type PickedPhoto } from "../photos/issuePhotos";
import i18n, { bookingError } from "../../../i18n";
import { codeOf } from "../components/BookingActions";
import { slotLabel, type ScheduleSlot } from "../schedule";

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
  minor_repair: "mechanic",
  exterior_wash: "wash",
  interior_exterior_wash: "wash",
  deep_clean: "wash",
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
  // ADR-050: book a time instead of help now.
  const [bookLater, setBookLater] = useState(Boolean(route.params?.bookLater) || preferredType === "wash");
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [leadMin, setLeadMin] = useState<number | null>(null);
  // ADR-055: photos of the problem stay on the phone until the request exists.
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [showLandmark, setShowLandmark] = useState(false);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // G11: resending the same request while there is no signal.
  const [retrying, setRetrying] = useState<{ attempt: number; secondsLeft: number } | null>(null);
  const stopRetry = useRef(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  // ── Active request ──
  const [phase, setPhase] = useState<Phase>(resumeJobId ? "searching" : "details");
  const [jobId, setJobId] = useState<string | null>(resumeJobId);
  const [job, setJob] = useState<BackendJob | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  // ADR-023: while a no_match_found job is under 10 minutes old the search keeps
  // widening; null once the window has closed. Since ADR-032 the server widens
  // it on its own timer, so this screen's retry-search call only reads the live
  // radius for the copy (and nudges the search if the worker has not yet).
  const [widening, setWidening] = useState<SearchStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Rating ──
  const [canRate, setCanRate] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const keyboardHeight = useKeyboardHeight();
  // The sheet never takes more than ~62% of the screen, so on a small phone the
  // map, the back button and the sheet's own last row all stay on screen.
  const { height: windowHeight } = useWindowDimensions();
  const sheetMax = Math.min(520, Math.round(windowHeight * 0.62));
  const [rated, setRated] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Preselect the first service in the group the owner tapped on Home.
  useEffect(() => {
    if (serviceCode || catalog.length === 0) return;
    const match = preferredType ? catalog.find((s) => CODE_GROUP[s.code] === preferredType) : undefined;
    if (match) setServiceCode(match.code);
  }, [catalog, preferredType, serviceCode]);

  // Preselect the vehicle Home shows as "your vehicle" (the first one). It is
  // shown in the summary with a Change button, so the owner sees which car the
  // request is for; in an emergency one step fewer matters more than a choice.
  useEffect(() => {
    if (!vehicleId && vehicles.length > 0) setVehicleId(vehicles[0].id);
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
    let lastRetry = 0;
    const tick = async () => {
      try {
        const j = await jobsApi.getJob(jobId);
        if (stopped) return;
        setPollFailed(false);
        applyJob(j);
        if (j.status === "no_match_found") {
          // Re-search at most every 15 s (server allows 12/min per job).
          if (Date.now() - lastRetry >= 15000) {
            lastRetry = Date.now();
            const res = await jobsApi.retrySearch(jobId);
            if (stopped) return;
            if (res.window_open) {
              setWidening(res);
              setPhase("searching");
              return; // keep polling: the next getJob shows 'matching' on a hit
            }
            setWidening(null);
          } else {
            setPhase("searching");
            return;
          }
        } else {
          setWidening(null);
        }
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

  // Live partner position while they are on the way or working (Redis-backed
  // GET /jobs/{id}/partner-location). No position means no marker, never a guess.
  const [partnerPos, setPartnerPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const tracking = job?.status === "assigned" || job?.status === "partner_en_route" || job?.status === "in_progress";
  useEffect(() => {
    if (!jobId || !tracking) {
      setPartnerPos(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const loc = await jobsApi.getPartnerLocation(jobId);
        if (stopped) return;
        setPartnerPos(loc.latitude != null && loc.longitude != null ? { latitude: loc.latitude, longitude: loc.longitude } : null);
      } catch {
        /* keep the last known position; the next tick retries */
      }
    };
    void tick();
    const id = setInterval(tick, 8000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [jobId, tracking]);

  // Rating availability once complete.
  useEffect(() => {
    if (job?.status !== "completed" || !jobId) return;
    jobsApi
      .getRatings(jobId)
      .then((r) => setCanRate(r.can_rate))
      .catch(() => setCanRate(false));
  }, [job?.status, jobId]);

  // ── Actions ──
  const canSend = Boolean(pickup && serviceCode && vehicleId && (!bookLater || slot)) && !sending;

  const send = async () => {
    if (!pickup || !serviceCode || !vehicleId) return;
    // Close the keyboard before the notes field unmounts with the phase change;
    // otherwise Android can drop the hide event and leave the sheet lifted.
    Keyboard.dismiss();
    setSending(true);
    stopRetry.current = false;
    try {
      const created = await sendWithRetry(() => jobsApi.createJob(
        {
          vehicle_id: vehicleId,
          service_code: serviceCode,
          pickup_lat: pickup.latitude,
          pickup_lng: pickup.longitude,
          pickup_address_text: landmark.trim() || addressLabel || "Pinned location",
          issue_description: notes.trim() || undefined,
          scheduled_for: bookLater && slot ? slot.start : undefined,
        },
        idempotencyKey.current
      ), {
        stopped: () => stopRetry.current,
        onRetry: (attempt, msLeft) => setRetrying({ attempt, secondsLeft: Math.round(msLeft / 1000) }),
      });
      if (!created?.id) throw new Error("no id");
      idempotencyKey.current = newIdempotencyKey();
      if (photos.length) {
        // A failed photo never fails the request; the owner is told, and the
        // request is already on its way.
        const toSend = photos;
        setPhotos([]);
        void uploadIssuePhotos(created.id, toSend).then(({ failed }) => {
          if (failed) {
            setPhotoNote(failed === toSend.length
              ? "Your photos could not be sent. Your request is on its way."
              : "A photo could not be sent. Your request is on its way.");
          }
          void qc.invalidateQueries({ queryKey: ["safeguards", created.id] });
        });
      }
      if (created.status === "scheduled") {
        // ADR-050: nothing to track yet. Confirm and go back; Activity holds the booking.
        void qc.invalidateQueries({ queryKey: QK.jobs });
        showDialog(
          i18n.t("booking.booked"),
          i18n.t("booking.bookedBody", { slot: slotLabel(created.scheduled_for, created.slot_end) }),
        );
        setBookLater(false);
        setSlot(null);
        if (nav.canGoBack()) nav.goBack();
        return;
      }
      setStartCode("");
      setJobId(created.id);
      setJob(created);
      setPhase("searching");
      void qc.invalidateQueries({ queryKey: QK.jobs });
    } catch (err) {
      const booking = bookingError(codeOf(err));
      if (booking) {
        // ADR-050: a refused booking says why (slot gone, three upcoming already).
        showDialog(i18n.t("booking.notBooked"), booking);
      } else if (err instanceof RetryStopped) {
        showDialog("Request not sent", "You stopped sending. No partner has been requested. If you need help now, call 112.");
      } else if (isNoSignal(err)) {
        showDialog("No signal", "We kept trying for three minutes but could not reach Sahayak. No partner has been requested. Move to better signal and try again, or call 112.");
      } else {
        showDialog("Request not sent", "Sahayak could not accept this request, so no partner has been requested. Check the details and try again.");
      }
    } finally {
      setRetrying(null);
      setSending(false);
    }
  };

  const cancel = () =>
    showDialog(
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
                showDialog("Could not cancel", "Please try again.");
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
      goBack();
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setRated(true);
        goBack();
      } else setRateError(`Could not submit your rating. ${e?.message ?? "Try again."}`);
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
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

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
  // ADR-057/058: share the owner's live location with the accepted partner, and chat.
  const contactActive = phase === "matched" && isActiveStatus(job?.status);
  const sharingLive = useShareOwnerLocation(job?.id, contactActive);
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useJobChat(job?.id, phase === "matched" && !!assignment, chatOpen);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      <RealMap
        userLocation={mapLocation}
        partnerLocation={partnerPos}
        showRoute={Boolean(partnerPos)}
        showRadar={phase === "searching"}
        radarRadius={900}
        draggable={phase === "details"}
        onUserMarkerDragEnd={(c) => setPickup(c)}
      />

      {/* Floating back control */}
      <SafeAreaView style={styles.topBar} edges={["top"]} pointerEvents="box-none">
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" style={[styles.fab, Shadows.floating as object]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        {phase === "details" && !pickup ? (
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>{locating ? "Finding your location…" : "Set your pickup: use GPS or drag the pin"}</Text>
          </View>
        ) : null}
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.sheetWrap, Platform.OS === "android" && keyboardHeight > 0 && { bottom: keyboardHeight }]}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, Shadows.sheet as object, { paddingBottom: Math.max(insets.bottom, Spacing.base) }]}>
          <View style={styles.grabber} />

          {/* ───────── DETAILS ─────────
              Two flows, not one form with a toggle buried in it (Drive Fixit and
              Urban Company both split them): "Get help now" is service tiles and
              a big button over the map; "Book a service" leads with the date and
              time. The action button is pinned below the scroll so it never
              disappears under the fold. */}
          {phase === "details" && (
            <>
              <ScrollView
                style={{ maxHeight: Math.round(windowHeight * (bookLater ? 0.6 : 0.46)) }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.headRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.h1} accessibilityRole="header">
                      {bookLater ? i18n.t("booking.title") : "Roadside help"}
                    </Text>
                    <Text style={styles.headSub}>
                      {bookLater ? i18n.t("booking.subtitle") : "We send your request to the best-matched verified partner nearby."}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setBookLater(!bookLater);
                      setSlot(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={bookLater ? i18n.t("booking.helpNowLink") : i18n.t("booking.bookATime")}
                    style={styles.modeLink}
                  >
                    <Ionicons name={bookLater ? "flash-outline" : "calendar-outline"} size={16} color={Colors.brand700} />
                    <Text style={styles.modeLinkText}>{bookLater ? i18n.t("booking.helpNowLink") : i18n.t("booking.bookATime")}</Text>
                  </Pressable>
                </View>

                {/* What */}
                <Text style={styles.label}>What do you need?</Text>
                {catalogState === "loading" ? (
                  <Skeleton height={104} />
                ) : catalogState === "error" ? (
                  <ErrorState message="We could not load the list of services." onRetry={loadCatalog} />
                ) : catalog.length === 0 ? (
                  <EmptyState icon="construct-outline" title="No services available" message="Please try again in a little while." />
                ) : (
                  <ServiceTiles services={bookLater ? catalog : catalog.filter((s) => !s.booking_only)} groupOf={(c) => CODE_GROUP[c]} value={serviceCode} onChange={setServiceCode} />
                )}

                {/* When (ADR-050), booking only */}
                {bookLater ? (
                  <>
                    <Text style={styles.label}>{i18n.t("booking.when")}</Text>
                    <SlotPicker value={slot?.start ?? null} onChange={setSlot} onLeadMinutes={setLeadMin} />
                  </>
                ) : null}

                {/* Where and which vehicle */}
                <Text style={styles.label}>{bookLater ? "Where and for which vehicle?" : "Where are you?"}</Text>
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Ionicons name="location" size={22} color={pickup ? Colors.brand700 : Colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickupText} numberOfLines={2}>
                        {pickup ? addressLabel || `${pickup.latitude.toFixed(4)}, ${pickup.longitude.toFixed(4)}` : "Pickup not set yet"}
                      </Text>
                      <Text style={styles.summarySub} numberOfLines={2}>
                        {locationNote ?? (pickup ? `${accuracyM != null ? `GPS about ${Math.round(accuracyM)} m. ` : ""}Drag the pin to fine-tune.` : "Use GPS or drag the pin on the map.")}
                      </Text>
                    </View>
                    <Pressable onPress={() => void locate(true)} accessibilityRole="button" accessibilityLabel="Use my current location" style={styles.locBtn}>
                      <Text style={styles.locBtnText}>{locating ? "…" : "GPS"}</Text>
                    </Pressable>
                  </View>
                  {showLandmark || landmark ? (
                    <TextInput
                      value={landmark}
                      onChangeText={setLandmark}
                      placeholder="Landmark, e.g. near the blue petrol pump"
                      placeholderTextColor={Colors.textMuted}
                      accessibilityLabel="Landmark"
                      style={styles.input}
                      autoFocus={showLandmark && !landmark}
                    />
                  ) : (
                    <Pressable onPress={() => setShowLandmark(true)} accessibilityRole="button" style={styles.addLink}>
                      <Ionicons name="add" size={18} color={Colors.brand700} />
                      <Text style={styles.addLinkText}>Add a landmark</Text>
                    </Pressable>
                  )}

                  <View style={styles.divider} />

                  {vehiclesState === "loading" ? (
                    <Skeleton height={48} />
                  ) : vehiclesState === "error" ? (
                    <ErrorState message="We could not load your vehicles." onRetry={loadVehicles} />
                  ) : selectedVehicle && !vehiclePickerOpen ? (
                    <View style={styles.summaryRow}>
                      <Ionicons name={selectedVehicle.vehicle_type === "two_wheeler" ? "bicycle-outline" : "car-outline"} size={22} color={Colors.brand700} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickupText} numberOfLines={1}>{`${selectedVehicle.make} ${selectedVehicle.model}`}</Text>
                        <Text style={styles.summarySub}>{selectedVehicle.vehicle_number}</Text>
                      </View>
                      <Pressable onPress={() => setVehiclePickerOpen(true)} accessibilityRole="button" accessibilityLabel="Change vehicle" style={styles.changeBtn}>
                        <Text style={styles.changeText}>Change</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.chips}>
                      {vehicles.map((v) => (
                        <Chip
                          key={v.id}
                          icon={v.vehicle_type === "two_wheeler" ? "bicycle-outline" : "car-outline"}
                          label={`${v.make} ${v.model} · ${v.vehicle_number}`}
                          selected={vehicleId === v.id}
                          onPress={() => {
                            setVehicleId(v.id);
                            setVehiclePickerOpen(false);
                          }}
                        />
                      ))}
                      <Chip icon="add" label={vehicles.length === 0 ? "Add your vehicle" : "Add another"} onPress={() => setAddVehicleOpen(true)} />
                    </View>
                  )}
                </View>

                {/* Extras */}
                <Text style={styles.label}>Show the partner (optional)</Text>
                <IssuePhotoPicker photos={photos} onChange={setPhotos} />
                {showNote || notes ? (
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="e.g. Left rear tyre is flat, hazards are on."
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    accessibilityLabel="Notes"
                    autoFocus={showNote && !notes}
                    style={[styles.input, { minHeight: 76, textAlignVertical: "top", paddingTop: 12 }]}
                  />
                ) : (
                  <Pressable onPress={() => setShowNote(true)} accessibilityRole="button" style={[styles.addLink, { marginTop: Spacing.sm }]}>
                    <Ionicons name="create-outline" size={18} color={Colors.brand700} />
                    <Text style={styles.addLinkText}>Add a note</Text>
                  </Pressable>
                )}
                <View style={{ height: Spacing.base }} />
              </ScrollView>

              {/* Pinned footer */}
              <View style={styles.footer}>
                {bookLater && slot ? (
                  <View style={styles.whenBar}>
                    <Ionicons name="calendar-outline" size={20} color={Colors.brand700} />
                    <Text style={styles.whenText}>{slotLabel(slot.start, slot.end)}</Text>
                  </View>
                ) : null}
                {retrying ? (
                  <View style={styles.retryBox} accessibilityLiveRegion="polite">
                    <Ionicons name="cellular-outline" size={20} color={Colors.warning} />
                    <Text style={styles.retryText}>
                      No signal. Sending again automatically (try {retrying.attempt}, up to {Math.max(0, Math.ceil(retrying.secondsLeft / 60))} more min).
                    </Text>
                    <Pressable onPress={() => { stopRetry.current = true; }} accessibilityRole="button" accessibilityLabel="Stop sending" style={styles.retryStop}>
                      <Text style={styles.retryStopText}>Stop</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Button
                  label={bookLater ? (slot ? i18n.t("booking.confirm") : i18n.t("booking.pickATime")) : "Get help now"}
                  variant={bookLater ? "primary" : "emergency"}
                  onPress={send}
                  loading={sending}
                  disabled={!canSend}
                  icon={<Ionicons name={bookLater ? "calendar-outline" : "flash"} size={22} color="#fff" />}
                />
                <Text style={styles.footNote}>
                  {!canSend && !sending
                    ? `${!serviceCode ? "Choose what you need" : bookLater && !slot ? "Pick a time" : !pickup ? "Set your pickup location" : "Choose or add a vehicle"} to continue.`
                    : bookLater
                      ? i18n.t("booking.leadNote", { min: leadMin ?? 45 })
                      : "Final price is confirmed when the job is completed."}
                </Text>
              </View>
            </>
          )}

          {/* ───────── SEARCHING ───────── */}
          {phase === "searching" && (
            <ScrollView style={{ maxHeight: sheetMax }} showsVerticalScrollIndicator={false}>
              <View style={styles.searchHead}>
                <Pulse />
                <View style={{ flex: 1 }}>
                  <Text style={styles.h1}>Finding a partner</Text>
                  <Text style={styles.muted}>
                    {widening
                      ? `No one close by yet. Searching up to ${Math.round(widening.radius_m / 1000)} km · ${Math.floor(widening.elapsed_s / 60)}m ${Math.floor(widening.elapsed_s % 60)}s of up to ${Math.round(widening.window_s / 60)} min.`
                      : "We are offering your request to the best-matched verified partners nearby."}
                  </Text>
                </View>
              </View>
              {job?.service_name ? (
                <Text style={styles.summary}>
                  {job.service_name}
                  {job.vehicle_number ? ` · ${job.vehicle_number}` : ""}
                </Text>
              ) : null}
              {pollFailed ? <Text style={styles.warn}>Connection is unstable. We will keep trying.</Text> : null}
              {photoNote ? <Text style={styles.photoNote}>{photoNote}</Text> : null}
              {job?.id ? <OwnerIssuePhotos jobId={job.id} /> : null}
              <Text style={styles.note}>You can leave this screen. Your request stays active and appears on Home.</Text>
              <View style={{ marginTop: Spacing.base, gap: Spacing.sm }}>
                <Button label="Cancel request" variant="outline" onPress={cancel} loading={cancelling} />
              </View>
              <View style={{ marginTop: Spacing.base }}>
                <SafetyActions jobId={job?.id} shareToken={job?.share_token} />
              </View>
            </ScrollView>
          )}

          {/* ───────── MATCHED ───────── */}
          {phase === "matched" && job && (
            <ScrollView style={{ maxHeight: sheetMax }} showsVerticalScrollIndicator={false}>
              <JobChatModal
                visible={chatOpen}
                onClose={() => setChatOpen(false)}
                title={partnerName ?? "Your partner"}
                as="owner"
                items={chat.items}
                canSend={chat.canSend}
                error={chat.error}
                onSend={chat.send}
              />
              {contactActive ? (
                <View style={styles.shareRow} accessibilityLiveRegion="polite">
                  <Ionicons name={sharingLive ? "navigate" : "navigate-outline"} size={16} color={sharingLive ? Colors.success : Colors.textMuted} />
                  <Text style={styles.shareText}>
                    {sharingLive ? "Your live location is shared with your partner" : "Keep this screen open to share your live location"}
                  </Text>
                </View>
              ) : null}
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
                    {/* "0.0 rating · 0 jobs" reads as a bad partner; with no
                        ratings yet they are simply new. */}
                    {assignment?.partner_rating != null && (assignment.partner_rating_count ?? 0) > 0
                      ? `★ ${Number(assignment.partner_rating).toFixed(1)} · ${assignment.partner_rating_count} ${assignment.partner_rating_count === 1 ? "rating" : "ratings"}`
                      : "New partner · Verified by Sahayak"}
                  </Text>
                </View>
                {assignment && contactActive ? (
                  <Pressable
                    onPress={() => setChatOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={chat.unread ? `Message ${partnerName ?? "your partner"}, ${chat.unread} new` : `Message ${partnerName ?? "your partner"}`}
                    style={[styles.callBtn, styles.chatBtn]}
                  >
                    <Ionicons name="chatbubble-ellipses" size={22} color={Colors.brand700} />
                    {chat.unread ? <View style={styles.unreadDot} /> : null}
                  </Pressable>
                ) : null}
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
                  <Text style={styles.codeHelp}>Say it to your partner face to face, at your vehicle. Never share it on a call or message. Work cannot start without it.</Text>
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
                <OwnerJobSafeguards jobId={job.id} />
              </View>

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
            <ScrollView style={{ maxHeight: sheetMax }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                            <Ionicons name={n <= rating ? "star" : "star-outline"} size={36} color={n <= rating ? "#F59E0B" : Colors.textMuted} />
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
                    {job.status !== "no_match_found"
                      ? "This request is closed. You can start a new one any time."
                      : job.timeline?.some((t) => t.status === "matching")
                      ? "Every nearby verified partner was offered this job and none could take it. You can try again, or call 112 if you are unsafe."
                      : "No verified partner offering this service is available near you right now. Try again in a few minutes, or choose a different service."}
                  </Text>
                </View>
              )}
              <View style={{ marginTop: Spacing.base, gap: Spacing.sm }}>
                <Button
                  label={job.status === "completed" ? (canRate && !rated && rating > 0 ? "Submit & done" : "Done") : "Request again"}
                  onPress={job.status !== "completed" ? startAnother : canRate && !rated && rating > 0 ? submitRating : goBack}
                  loading={rateBusy}
                />
                {job.status === "completed" && jobId ? (
                  <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                    <View style={{ flex: 1 }}><Button label="Receipt" variant="outline" onPress={() => nav.navigate("Receipt", { jobId })} /></View>
                    <View style={{ flex: 1 }}><Button label="Report issue" variant="ghost" onPress={() => nav.navigate("ReportProblem", { jobId, title: job.service_name ?? undefined })} /></View>
                  </View>
                ) : null}
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
        Animated.timing(scale, { toValue: 1.35, duration: 1600, useNativeDriver: true }),
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
  fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#141518", alignItems: "center", justifyContent: "center" },
  mapHint: { flex: 1, backgroundColor: "rgba(20,21,24,0.88)", borderRadius: Radius.full, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  mapHintText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium, color: "#fff" },

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
  pulseWrap: { width: 56, height: 56, margin: 6, alignItems: "center", justifyContent: "center", zIndex: 0 },
  pulseRing: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700 },
  pulseCore: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },

  matchedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.md },
  eta: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  partnerCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.brand700 },
  partnerName: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  chatBtn: { backgroundColor: Colors.brand700Muted, borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.sm },
  unreadDot: { position: "absolute", top: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.error, borderWidth: 2, borderColor: "#fff" },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: Spacing.sm },
  shareText: { flex: 1, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium },
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
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  headSub: { marginTop: 4, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 20 },
  modeLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: Radius.full, backgroundColor: Colors.brand700Muted, borderWidth: 1, borderColor: Colors.border },
  modeLinkText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  summaryCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceWhite, padding: Spacing.md, gap: Spacing.sm },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: 48 },
  summarySub: { marginTop: 2, fontSize: Typography.fontSize.xs, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginVertical: 2 },
  addLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, alignSelf: "flex-start" },
  addLinkText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  changeBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  changeText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  footer: { paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, marginHorizontal: -Spacing.lg, paddingHorizontal: Spacing.lg },
  whenBar: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  whenText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  footNote: { marginTop: 8, textAlign: "center", fontSize: Typography.fontSize.xs, color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium, lineHeight: 18 },
  photoNote: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.warning, fontFamily: Typography.fontFamily.medium },
  retryBox: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, backgroundColor: Colors.warningLight, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  retryText: { flex: 1, fontFamily: Typography.fontFamily.medium, fontSize: 15, color: Colors.textPrimary },
  retryStop: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.sm },
  retryStopText: { fontFamily: Typography.fontFamily.semiBold, fontSize: 15, color: Colors.error },
});
