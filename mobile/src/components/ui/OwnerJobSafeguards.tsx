// Owner side of the 2026-11-21 job safeguards (ADR-039, ADR-041, research F6):
//  * approve or reject a partner's request to charge more than the estimate;
//  * "Find another partner" once the partner is overdue;
//  * a standing warning against helpers who are not the assigned partner.
import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors, Radius, Spacing, Typography } from "../../constants/theme";
import Button from "./Button";
import { showDialog } from "./AppDialog";
import { amountOf, minutesUntil, safeguardsApi } from "../../services/api/safeguards";

const inr = (v: number | null) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const errCode = (e: any): string | undefined => e?.response?.data?.error?.code;

export default function OwnerJobSafeguards({ jobId, onPartnerReleased }: { jobId: string; onPartnerReleased?: () => void }) {
  const qc = useQueryClient();
  const key = ["safeguards", jobId];
  const q = useQuery({ queryKey: key, queryFn: () => safeguardsApi.get(jobId), refetchInterval: 10000 });
  const [busy, setBusy] = useState<"approve" | "reject" | "swap" | null>(null);
  const data = q.data;

  const decide = async (approve: boolean) => {
    const pending = data?.pending_revision;
    if (!pending) return;
    setBusy(approve ? "approve" : "reject");
    try {
      await safeguardsApi.decidePrice(jobId, pending.id, approve);
    } catch (e) {
      showDialog(
        "Answer not saved",
        errCode(e) === "PRICE_REVISION_CLOSED"
          ? "This price change was already answered or the job has moved on."
          : "Check your connection and try again."
      );
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const swap = () =>
    showDialog("Find another partner?", "Your current partner will be released and we will search again from the same place.", [
      { text: "Keep waiting", style: "cancel" },
      {
        text: "Find another",
        style: "destructive",
        onPress: async () => {
          setBusy("swap");
          try {
            await safeguardsApi.requestNewPartner(jobId);
            onPartnerReleased?.();
          } catch (e) {
            showDialog(
              "Could not change partner",
              errCode(e) === "PARTNER_NOT_OVERDUE"
                ? "Your partner is still within their arrival time."
                : errCode(e) === "JOB_NOT_REASSIGNABLE"
                  ? "Work has already started on this job."
                  : "Check your connection and try again."
            );
          } finally {
            setBusy(null);
            void qc.invalidateQueries({ queryKey: key });
          }
        },
      },
    ]);

  const pending = data?.pending_revision;
  const waitMin = minutesUntil(data?.new_partner_available_at);

  return (
    <View style={{ gap: Spacing.md }}>
      {pending ? (
        <View style={[styles.card, styles.attention]} accessibilityLiveRegion="polite">
          <View style={styles.row}>
            <Ionicons name="pricetag" size={20} color={Colors.warning} />
            <Text style={styles.title}>Your partner asks for a higher price</Text>
          </View>
          <Text style={styles.body}>
            New price {inr(amountOf(pending.proposed_amount))} · estimate was {inr(amountOf(data?.price_estimate))}
          </Text>
          <Text style={styles.reason}>“{pending.reason}”</Text>
          <Text style={styles.muted}>Nothing above the estimate can be charged unless you approve it here.</Text>
          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button label="Reject" variant="outline" onPress={() => void decide(false)} loading={busy === "reject"} disabled={busy !== null} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Approve" onPress={() => void decide(true)} loading={busy === "approve"} disabled={busy !== null} />
            </View>
          </View>
        </View>
      ) : null}

      {data?.can_request_new_partner ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="time" size={20} color={Colors.error} />
            <Text style={styles.title}>Your partner is late</Text>
          </View>
          <Text style={styles.body}>You can keep waiting or ask Sahayak for another partner. Your request stays open.</Text>
          <Button label="Find another partner" variant="outline" onPress={swap} loading={busy === "swap"} disabled={busy !== null} />
        </View>
      ) : waitMin != null && waitMin > 0 ? (
        <Text style={styles.muted}>Not here in {waitMin} min? You will be able to ask for another partner.</Text>
      ) : null}

      <View style={styles.tip} accessible accessibilityRole="text">
        <Ionicons name="shield-checkmark" size={18} color={Colors.brand700} />
        <Text style={styles.tipText}>
          Only the partner shown here is from Sahayak. Say your start code face to face, never on a call. Pay only the price in the
          app, and report anyone who asks you to cancel and pay them directly.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceWhite, borderRadius: Radius.lg, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  attention: { borderColor: Colors.warning, backgroundColor: Colors.warningLight },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  title: { fontFamily: Typography.fontFamily.semiBold, fontSize: 16, color: Colors.textPrimary, flex: 1 },
  body: { fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textPrimary },
  reason: { fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textSecondary, fontStyle: "italic" },
  muted: { fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textMuted },
  actions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xs },
  tip: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start", backgroundColor: Colors.brand700Muted, borderRadius: Radius.md, padding: Spacing.md },
  tipText: { flex: 1, fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textSecondary, lineHeight: 21 },
});
