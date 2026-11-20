// The partner's document checklist (ADR-038): one row per required document,
// with its review status and, when allowed, an upload button. A rejected
// document shows the reason staff gave.
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import Card from "../../../components/ui/Card";
import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import { partnerApi, type DocType, type PartnerDocuments } from "../../../services/api/partner";
import { DOC_LABEL, STATUS_LABEL, canUpload, putFile, uploadContentType } from "../documents";

const TONE: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  missing: { color: Colors.textMuted, icon: "ellipse-outline" },
  pending: { color: Colors.warning, icon: "time" },
  approved: { color: Colors.success, icon: "checkmark-circle" },
  rejected: { color: Colors.error, icon: "alert-circle" },
  expired: { color: Colors.error, icon: "alert-circle" },
};

export default function DocumentsCard({ docs, onChange }: { docs: PartnerDocuments; onChange: (d: PartnerDocuments) => void }) {
  const [busy, setBusy] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rcNumber, setRcNumber] = useState("");

  const upload = async (docType: DocType, fromCamera: boolean) => {
    setError(null);
    if (docType === "tow_vehicle_rc" && rcNumber.trim().length < 4) {
      setError("Type the tow vehicle's registration number first.");
      return;
    }
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(fromCamera ? "Camera permission is needed to photograph the document." : "Photo access is needed to choose the document.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, allowsEditing: false };
    const picked = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const contentType = uploadContentType(asset.mimeType);
    setBusy(docType);
    try {
      const ticket = await partnerApi.startDocumentUpload({
        doc_type: docType,
        content_type: contentType,
        ...(docType === "tow_vehicle_rc" ? { reference_number: rcNumber.trim() } : {}),
      });
      await putFile(ticket.upload_url, asset.uri, contentType);
      onChange(await partnerApi.confirmDocumentUpload(ticket.document_id));
    } catch (e) {
      setError(e instanceof Error && e.message === "TOO_LARGE"
        ? "That photo is larger than 5 MB. Take it again a little further away."
        : "The upload did not finish. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <Text style={styles.h2}>Your documents</Text>
      <Text style={styles.note}>
        The Sahayak team checks these before you can receive jobs. Only verification staff can see them.
      </Text>
      {docs.documents.map((d) => {
        const label = DOC_LABEL[d.doc_type];
        const tone = TONE[d.status];
        const open = canUpload(d.status);
        return (
          <View key={d.doc_type} style={styles.row}>
            <View style={styles.rowHead}>
              <Ionicons name={tone.icon} size={22} color={tone.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{label.title}</Text>
                <Text style={[styles.status, { color: tone.color }]}>{STATUS_LABEL[d.status]}</Text>
              </View>
            </View>
            {d.status === "rejected" && d.rejection_reason ? (
              <Text style={styles.reason} accessibilityLabel={`Reason: ${d.rejection_reason}`}>Reason: {d.rejection_reason}</Text>
            ) : null}
            {open ? (
              <>
                <Text style={styles.hint}>{label.hint}</Text>
                {d.doc_type === "tow_vehicle_rc" ? (
                  <TextInput
                    value={rcNumber}
                    onChangeText={setRcNumber}
                    placeholder="Tow vehicle number, e.g. KA01AB1234"
                    autoCapitalize="characters"
                    maxLength={30}
                    style={styles.input}
                    accessibilityLabel="Tow vehicle registration number"
                  />
                ) : null}
                {busy === d.doc_type ? (
                  <ActivityIndicator color={Colors.brand700} style={{ marginTop: 8 }} />
                ) : (
                  <View style={styles.actions}>
                    <Pressable style={styles.btn} disabled={busy !== null} onPress={() => void upload(d.doc_type, true)}
                      accessibilityRole="button" accessibilityLabel={`Photograph your ${label.title}`}>
                      <Ionicons name="camera" size={18} color={Colors.textPrimary} />
                      <Text style={styles.btnText}>Take photo</Text>
                    </Pressable>
                    <Pressable style={styles.btn} disabled={busy !== null} onPress={() => void upload(d.doc_type, false)}
                      accessibilityRole="button" accessibilityLabel={`Choose a photo of your ${label.title}`}>
                      <Ionicons name="images" size={18} color={Colors.textPrimary} />
                      <Text style={styles.btnText}>Choose photo</Text>
                    </Pressable>
                  </View>
                )}
              </>
            ) : null}
          </View>
        );
      })}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, marginBottom: 4 },
  note: { fontSize: 13, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  rowHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  title: { fontSize: 15, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  status: { fontSize: 13, fontFamily: Typography.fontFamily.medium },
  reason: { fontSize: 14, color: Colors.error, marginTop: 8 },
  hint: { fontSize: 13, color: Colors.textSecondary, marginTop: 8 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 12, minHeight: 48, marginTop: 8, fontSize: 15, color: Colors.textPrimary },
  actions: { flexDirection: "row", gap: Spacing.sm, marginTop: 10 },
  btn: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.full },
  btnText: { fontSize: 14, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  error: { fontSize: 14, color: Colors.error, marginTop: Spacing.sm },
});
