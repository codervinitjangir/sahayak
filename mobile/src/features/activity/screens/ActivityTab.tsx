import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Radius, Spacing } from "../../../constants/theme";
import type { OwnerStackParamList } from "../../../types";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { Chip, EmptyState, ErrorState, Skeleton, StatusChip } from "../../../components/ui/kit";
import { jobsApi, type BackendJob } from "../../../services/api/jobs";
import { QK, useMyJobs, isActiveStatus, formatWhen } from "../../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList>;
type Filter = "all" | "active" | "past";

const CANCEL_REASONS = ["Got help another way", "Waiting too long", "Booked by mistake", "Other"];

export default function ActivityTab() {
  const nav = useNavigation<Nav>();
  const jobs = useMyJobs();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<BackendJob | null>(null);

  const items = (jobs.data ?? []).filter((j) =>
    filter === "all" ? true : filter === "active" ? isActiveStatus(j.status) : !isActiveStatus(j.status)
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Activity
        </Text>
        <View style={styles.filters}>
          {(["all", "active", "past"] as const).map((f) => (
            <Chip key={f} label={f === "all" ? "All" : f === "active" ? "Active" : "Past"} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      </View>

      {jobs.isLoading ? (
        <View style={styles.pad}>
          <Skeleton height={96} />
          <Skeleton height={96} style={{ marginTop: Spacing.md }} />
        </View>
      ) : jobs.isError ? (
        <ErrorState message="We could not load your requests." onRetry={() => void jobs.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(j) => j.id}
          contentContainerStyle={[styles.pad, { paddingBottom: Spacing["4xl"], gap: Spacing.md }]}
          refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} tintColor={Colors.brand700} />}
          ListEmptyComponent={
            <EmptyState
              icon="time-outline"
              title={filter === "all" ? "No requests yet" : "Nothing here"}
              message={filter === "all" ? "When you ask for help it will show up here." : "Try a different filter."}
            />
          }
          renderItem={({ item: j }) => (
            <Pressable
              onPress={() => setSelected(j)}
              accessibilityRole="button"
              accessibilityLabel={`${j.service_name ?? "Request"}, ${j.status}. Open details.`}
            >
              <Card>
                <View style={styles.cardTop}>
                  <Text style={styles.svc} numberOfLines={1}>
                    {j.service_name ?? "Roadside help"}
                  </Text>
                  <StatusChip status={j.status} />
                </View>
                {j.vehicle_number ? <Text style={styles.plate}>{j.vehicle_number}</Text> : null}
                <View style={styles.addrRow}>
                  <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.muted} numberOfLines={1}>
                    {j.pickup_address_text || "Pickup location"}
                  </Text>
                </View>
                <Text style={[styles.muted, { marginTop: 6 }]}>{formatWhen(j.requested_at ?? j.created_at)}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}

      <JobSheet
        job={selected}
        onClose={() => setSelected(null)}
        onTrack={(id) => {
          setSelected(null);
          nav.navigate("OwnerFlow", { jobId: id });
        }}
      />
    </View>
  );
}

function JobSheet({
  job,
  onClose,
  onTrack,
}: {
  job: BackendJob | null;
  onClose: () => void;
  onTrack: (jobId: string) => void;
}) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rated, setRated] = useState(false);

  const completed = job?.status === "completed";
  const ratings = useQuery({
    queryKey: ["owner", "ratings", job?.id],
    queryFn: () => jobsApi.getRatings(job!.id),
    enabled: Boolean(job) && completed,
  });
  const canRate = completed && !rated && (ratings.data?.can_rate ?? false);

  const reset = () => {
    setCancelling(false);
    setReason(null);
    setRating(0);
    setComment("");
    setErr(null);
    setRated(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const doCancel = async () => {
    if (!job) return;
    setBusy(true);
    setErr(null);
    try {
      await jobsApi.cancelJob(job.id, reason ?? "Cancelled by owner");
      await qc.invalidateQueries({ queryKey: QK.jobs });
      close();
    } catch (e: any) {
      // 409 means it already reached a terminal state, which is what was asked for.
      if (e?.response?.status === 409) {
        await qc.invalidateQueries({ queryKey: QK.jobs });
        close();
      } else {
        setErr("Could not cancel this request. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = () =>
    Alert.alert("Cancel this request?", "Your partner will be told and the request will be closed.", [
      { text: "Keep request", style: "cancel" },
      { text: "Yes, cancel", style: "destructive", onPress: () => void doCancel() },
    ]);

  const submitRating = async () => {
    if (!job || rating === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await jobsApi.submitRating(job.id, rating, comment.trim() || undefined);
      setRated(true);
      await ratings.refetch();
    } catch (e: any) {
      if (e?.response?.status === 409) setRated(true);
      else setErr("Could not submit your rating. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!job) return null;
  const active = isActiveStatus(job.status);
  const price = job.price_final;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close details" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{job.service_name ?? "Roadside help"}</Text>
            <View style={{ marginTop: 8 }}>
              <StatusChip status={job.status} />
            </View>

            <View style={styles.facts}>
              <Fact icon="car-outline" label="Vehicle" value={job.vehicle_number ?? "—"} />
              <Fact icon="location-outline" label="Pickup" value={job.pickup_address_text || "—"} />
              <Fact icon="time-outline" label="Requested" value={formatWhen(job.requested_at ?? job.created_at) || "—"} />
              {job.counterpart_name ? <Fact icon="person-outline" label="Partner" value={job.counterpart_name} /> : null}
              {price != null ? (
                <Fact icon="receipt-outline" label="Final amount" value={`₹${Number(price)}`} />
              ) : active ? (
                <Fact icon="receipt-outline" label="Price" value="Confirmed when the job is completed" />
              ) : null}
              {job.status === "cancelled" && job.cancellation_reason ? (
                <Fact icon="close-circle-outline" label="Reason" value={job.cancellation_reason} />
              ) : null}
            </View>

            {active && !cancelling ? (
              <View style={{ gap: Spacing.sm, marginTop: Spacing.lg }}>
                <Button label="Track request" onPress={() => onTrack(job.id)} />
                <Button label="Cancel request" variant="outline" onPress={() => setCancelling(true)} />
              </View>
            ) : null}

            {active && cancelling ? (
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={styles.sub}>Why are you cancelling?</Text>
                <View style={styles.chips}>
                  {CANCEL_REASONS.map((r) => (
                    <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
                  ))}
                </View>
                <View style={{ gap: Spacing.sm, marginTop: Spacing.base }}>
                  <Button label="Cancel request" variant="danger" onPress={confirmCancel} loading={busy} />
                  <Button label="Keep request" variant="ghost" onPress={() => setCancelling(false)} disabled={busy} />
                </View>
              </View>
            ) : null}

            {completed && canRate ? (
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={styles.sub}>How was the service?</Text>
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
                      <Ionicons name={n <= rating ? "star" : "star-outline"} size={34} color={n <= rating ? "#F59E0B" : Colors.border} />
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Add a comment (optional)"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  style={styles.comment}
                  accessibilityLabel="Comment"
                />
                <View style={{ marginTop: Spacing.md }}>
                  <Button label="Submit rating" onPress={submitRating} disabled={rating === 0} loading={busy} />
                </View>
              </View>
            ) : null}
            {completed && (rated || (ratings.data && !ratings.data.can_rate)) ? (
              <View style={styles.thanks}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                <Text style={styles.thanksText}>Thanks for rating this service.</Text>
              </View>
            ) : null}

            {err ? (
              <Text style={styles.err} accessibilityRole="alert">
                {err}
              </Text>
            ) : null}
            <View style={{ height: Spacing.base }} />
            <Button label="Close" variant="ghost" onPress={close} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={20} color={Colors.brand700} />
      <View style={{ flex: 1 }}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: Spacing.screenHorizontal, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: Spacing.md },
  title: { fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.display },
  filters: { flexDirection: "row", gap: Spacing.sm },
  pad: { paddingHorizontal: Spacing.screenHorizontal },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
  svc: { flex: 1, fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  plate: { marginTop: 6, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium, color: Colors.textSecondary, letterSpacing: 0.6 },
  addrRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  muted: { flex: 1, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular },

  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: Colors.overlay },
  sheet: { maxHeight: "88%", backgroundColor: Colors.surfaceWhite, borderTopLeftRadius: Radius["2xl"], borderTopRightRadius: Radius["2xl"], padding: Spacing.lg, paddingTop: Spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: Spacing.md },
  sheetTitle: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  facts: { marginTop: Spacing.lg, gap: Spacing.md },
  fact: { flexDirection: "row", gap: Spacing.md, alignItems: "flex-start" },
  factLabel: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  factValue: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary, marginTop: 1 },
  sub: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  stars: { flexDirection: "row", gap: 4 },
  starBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  comment: { marginTop: Spacing.sm, minHeight: 80, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: 12, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.regular, color: Colors.textPrimary, textAlignVertical: "top" },
  thanks: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: Spacing.lg },
  thanksText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.success },
  err: { marginTop: Spacing.md, color: Colors.error, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium },
});
