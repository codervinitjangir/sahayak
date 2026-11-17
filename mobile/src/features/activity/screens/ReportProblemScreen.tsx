// "Report a problem" with a completed job (POST/GET /jobs/{id}/disputes).
// Shows earlier reports and their status; a new report is only offered when
// none is open. The Sahayak team resolves it from the admin console.
import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import ScreenHero from "../../../components/ui/ScreenHero";
import Button from "../../../components/ui/Button";
import { ErrorState, SectionHeader } from "../../../components/ui/kit";
import { disputesApi, DISPUTE_REASONS, type DisputeReason, type DisputeStatus } from "../../../services/api/disputes";
import { formatWhen } from "../../shared/ownerData";

type Params = { ReportProblem: { jobId: string; title?: string } };

const STATUS: Record<DisputeStatus, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  open: { label: "Under review", color: "#B45309", bg: "#FEF3C7", icon: "time" },
  resolved: { label: "Resolved", color: "#15803D", bg: "#DCFCE7", icon: "checkmark-circle" },
  refunded: { label: "Refunded", color: "#15803D", bg: "#DCFCE7", icon: "arrow-undo" },
  rejected: { label: "Closed", color: "#4B5563", bg: "#F3F4F6", icon: "close-circle" },
};

export default function ReportProblemScreen() {
  const nav = useNavigation();
  const { jobId, title } = useRoute<RouteProp<Params, "ReportProblem">>().params;
  const list = useQuery({ queryKey: ["disputes", jobId], queryFn: () => disputesApi.list(jobId) });
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasOpen = (list.data ?? []).some((d) => d.status === "open");

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setErr(null);
    try {
      await disputesApi.open(jobId, reason, text.trim());
      setReason(null);
      setText("");
      await list.refetch();
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      setErr(
        code === "DISPUTE_ALREADY_OPEN"
          ? "You already have an open report for this job."
          : code === "JOB_NOT_DISPUTABLE"
            ? "You can report a problem once the job is completed."
            : "Could not send your report. Try again."
      );
      if (code === "DISPUTE_ALREADY_OPEN") void list.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHero title="Report a problem" subtitle={title} left={{ icon: "chevron-back", onPress: () => nav.goBack(), label: "Back" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <ActivityIndicator color={Colors.brand700} />
        ) : list.isError ? (
          <ErrorState message="We could not load your reports." onRetry={() => void list.refetch()} />
        ) : (
          <>
            {(list.data ?? []).length > 0 ? (
              <View style={{ gap: Spacing.md }}>
                <SectionHeader title="Your reports" />
                {list.data!.map((d) => {
                  const st = STATUS[d.status];
                  return (
                    <View key={d.id} style={styles.report}>
                      <View style={styles.reportTop}>
                        <Text style={styles.reportReason}>{DISPUTE_REASONS.find((r) => r.value === d.reason)?.label ?? d.reason}</Text>
                        <View style={[styles.pill, { backgroundColor: st.bg }]}>
                          <Ionicons name={st.icon} size={13} color={st.color} />
                          <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                        </View>
                      </View>
                      {d.description ? <Text style={styles.body}>{d.description}</Text> : null}
                      <Text style={styles.muted}>Sent {formatWhen(d.created_at)}</Text>
                      {d.resolution_note ? (
                        <View style={styles.note}>
                          <Text style={styles.noteLabel}>Reply from Sahayak</Text>
                          <Text style={styles.body}>{d.resolution_note}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {!hasOpen ? (
              <View style={{ gap: Spacing.md }}>
                <SectionHeader title="What went wrong?" />
                <View style={styles.reasons} accessibilityRole="radiogroup">
                  {DISPUTE_REASONS.map((r) => {
                    const on = reason === r.value;
                    return (
                      <Pressable
                        key={r.value}
                        onPress={() => setReason(r.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={[styles.reason, on && styles.reasonOn]}
                      >
                        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? Colors.brand700 : Colors.textMuted} />
                        <Text style={styles.reasonText}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Tell us what happened (optional)"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  maxLength={1000}
                  style={styles.input}
                  accessibilityLabel="Details"
                />
                {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
                <Button label="Send report" onPress={() => void submit()} disabled={!reason} loading={busy} />
                <Text style={styles.muted}>The Sahayak team reviews every report and replies here.</Text>
              </View>
            ) : (
              <Text style={styles.muted}>Your report is with the Sahayak team. You can send another once this one is closed.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.xl, paddingBottom: 48 },
  report: { backgroundColor: Colors.surfaceWhite, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.base, gap: 6 },
  reportTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  reportReason: { flex: 1, fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.bold },
  note: { marginTop: 4, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, gap: 2 },
  noteLabel: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.bold, color: Colors.textSecondary },
  body: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.regular, color: Colors.textPrimary },
  muted: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  reasons: { gap: Spacing.sm },
  reason: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: 52, paddingHorizontal: Spacing.base, borderRadius: Radius.xl, backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  reasonOn: { borderColor: Colors.brand700, borderWidth: 1.5 },
  reasonText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary },
  input: { minHeight: 110, textAlignVertical: "top", borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceWhite, padding: Spacing.base, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.regular, color: Colors.textPrimary },
  err: { color: Colors.emergency, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.medium },
});
