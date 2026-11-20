// Partner side of the 2026-11-21 job safeguards:
//  * ADR-039: ask the owner to approve a price above the estimate (+10%);
//  * ADR-042: pickup and drop photos of the vehicle on a towing job.
import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { amountOf, safeguardsApi, type JobSafeguards } from "../../../services/api/safeguards";
import { putFile, uploadContentType } from "../documents";

const inr = (v: number | null) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const errCode = (e: any): string | undefined => e?.response?.data?.error?.code;

export function useSafeguards(jobId: string) {
  return useQuery({ queryKey: ["safeguards", jobId], queryFn: () => safeguardsApi.get(jobId), refetchInterval: 10000 });
}

/** What the completion form should say about the allowed amount. */
export function allowedHint(data: JobSafeguards | undefined): string {
  const max = amountOf(data?.price_allowed_max);
  if (!data) return "";
  if (max == null) return "This job has no estimate: ask the owner to approve the price before completing.";
  return `You can charge up to ${inr(max)} without asking. Above that, ask the owner first.`;
}

export default function PartnerJobSafeguards({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const q = useSafeguards(jobId);
  const data = q.data;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<"pickup" | "drop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["safeguards", jobId] });

  const ask = async () => {
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError("Enter the new total price.");
    if (reason.trim().length < 5) return setError("Tell the owner why, for example \"new battery needed\".");
    setAsking(true);
    try {
      await safeguardsApi.proposePrice(jobId, Math.round(n), reason.trim());
      setAmount("");
      setReason("");
    } catch (e) {
      const c = errCode(e);
      setError(
        c === "PRICE_REVISION_NOT_NEEDED"
          ? "That is within what you can charge already. Enter it when you complete."
          : c === "PRICE_FINAL_OUT_OF_RANGE"
            ? "That is above the most this job can be billed. Call Sahayak support."
            : c === "PRICE_REVISION_PENDING"
              ? "You already asked. Wait for the owner's answer."
              : "Could not send. Check your signal and try again."
      );
    } finally {
      setAsking(false);
      refresh();
    }
  };

  const photo = async (stage: "pickup" | "drop") => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError("Camera permission is needed to photograph the vehicle.");
    const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, allowsEditing: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const contentType = uploadContentType(asset.mimeType);
    setPhotoBusy(stage);
    try {
      const ticket = await safeguardsApi.startPhoto(jobId, stage, contentType);
      await putFile(ticket.upload_url, asset.uri, contentType);
      await safeguardsApi.confirmPhoto(jobId, ticket.photo_id);
    } catch (e) {
      setError(e instanceof Error && e.message === "TOO_LARGE"
        ? "That photo is larger than 5 MB. Take it again."
        : "The photo did not upload. Check your signal and try again.");
    } finally {
      setPhotoBusy(null);
      refresh();
    }
  };

  if (!data) return null;
  const pending = data.pending_revision;
  const last = data.revisions.length ? data.revisions[data.revisions.length - 1] : null;
  const count = (stage: "pickup" | "drop") => data.photos.filter((p) => p.stage === stage).length;

  return (
    <View style={{ gap: Spacing.md, marginBottom: Spacing.md }}>
      {data.photos_required ? (
        <View style={styles.card}>
          <Text style={styles.title}>Vehicle photos (required for towing)</Text>
          <Text style={styles.muted}>Photograph all sides before loading, and again at the drop point. These protect you in a damage claim.</Text>
          {(["pickup", "drop"] as const).map((stage) => (
            <View key={stage} style={styles.photoRow}>
              <Ionicons
                name={count(stage) ? "checkmark-circle" : "camera-outline"}
                size={22}
                color={count(stage) ? Colors.success : Colors.textMuted}
              />
              <Text style={styles.body}>
                {stage === "pickup" ? "Before towing" : "At the drop point"}
                {count(stage) ? ` · ${count(stage)} added` : ""}
              </Text>
              <Button
                label={count(stage) ? "Add another" : "Take photo"}
                size="sm"
                variant="outline"
                onPress={() => void photo(stage)}
                loading={photoBusy === stage}
                disabled={photoBusy !== null}
              />
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>Price</Text>
        <Text style={styles.muted}>{allowedHint(data)}</Text>
        {pending ? (
          <View style={styles.row}>
            <Ionicons name="hourglass-outline" size={18} color={Colors.warning} />
            <Text style={styles.body}>Waiting for the owner to approve {inr(amountOf(pending.proposed_amount))}</Text>
          </View>
        ) : (
          <>
            {last?.status === "rejected" ? (
              <View style={styles.row}>
                <Ionicons name="close-circle" size={18} color={Colors.error} />
                <Text style={styles.body}>The owner did not approve {inr(amountOf(last.proposed_amount))}.</Text>
              </View>
            ) : last?.status === "approved" ? (
              <View style={styles.row}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={styles.body}>Approved: {inr(amountOf(last.proposed_amount))}</Text>
              </View>
            ) : null}
            <Text style={styles.label}>Need to charge more? New total</Text>
            <View style={styles.amountRow}>
              <Text style={styles.body}>₹</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                accessibilityLabel="New total price"
              />
            </View>
            <TextInput
              style={[styles.input, { minHeight: 44 }]}
              value={reason}
              onChangeText={setReason}
              placeholder="Why? e.g. battery needs replacing"
              placeholderTextColor={Colors.textMuted}
              maxLength={500}
              accessibilityLabel="Reason for the new price"
            />
            <Button label="Ask owner to approve" variant="outline" onPress={() => void ask()} loading={asking} disabled={asking} />
          </>
        )}
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceWhite, borderRadius: Radius.lg, padding: Spacing.base, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  title: { fontFamily: Typography.fontFamily.semiBold, fontSize: 16, color: Colors.textPrimary },
  body: { fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textPrimary, flex: 1 },
  muted: { fontFamily: Typography.fontFamily.regular, fontSize: 15, color: Colors.textMuted },
  label: { fontFamily: Typography.fontFamily.medium, fontSize: 14, color: Colors.textSecondary, marginTop: Spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  photoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, minHeight: 48 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, minHeight: 48, fontSize: 16, color: Colors.textPrimary, fontFamily: Typography.fontFamily.regular },
  error: { fontFamily: Typography.fontFamily.medium, fontSize: 15, color: Colors.error },
});
