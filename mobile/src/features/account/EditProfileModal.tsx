// Owner edits their name and email (G8). Phone is the login and is not editable.
import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Colors, Typography, Radius, Spacing } from "../../constants/theme";
import Button from "../../components/ui/Button";
import { usersApi, type OwnerProfile } from "../../services/api/users";
import { partnerApi } from "../../services/api/partner";

export default function EditProfileModal({
  visible,
  profile,
  onClose,
  onSaved,
  mode = "owner",
}: {
  visible: boolean;
  profile: { name: string; email?: string | null } | null;
  onClose: () => void;
  onSaved: (p: OwnerProfile | { name: string }) => void;
  /** "partner": name only, saved through PATCH /partners/me. */
  mode?: "owner" | "partner";
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(profile?.name ?? "");
      setEmail(profile?.email ?? "");
      setError(null);
    }
  }, [visible, profile]);

  const save = async () => {
    const n = name.trim();
    const e = email.trim();
    if (!n) {
      setError("Enter your name.");
      return;
    }
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      setError("That email address does not look right.");
      return;
    }
    setSaving(true);
    try {
      const saved = mode === "partner"
        ? await partnerApi.updateMe(n)
        : await usersApi.updateMe({ name: n, email: e || null });
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.code === "USER_ALREADY_EXISTS"
          ? "Another account already uses this email address."
          : "Could not save. Check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.scrim}>
        <Pressable style={styles.scrimTap} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title} accessibilityRole="header">Edit profile</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={styles.input}
            maxLength={100} autoCapitalize="words" placeholderTextColor={Colors.textMuted} />
          {mode === "owner" ? (
            <>
              <Text style={[styles.label, { marginTop: Spacing.md }]}>Email (optional)</Text>
              <TextInput value={email} onChangeText={setEmail} accessibilityLabel="Email" style={styles.input}
                maxLength={150} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={Colors.textMuted} />
            </>
          ) : null}
          <Text style={styles.hint}>Your phone number is how you sign in, so it cannot be changed here.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
            <Button label="Save" onPress={save} loading={saving} />
            <Button label="Cancel" variant="ghost" onPress={onClose} disabled={saving} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: Colors.overlay },
  scrimTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.surfaceWhite,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: Spacing.md },
  title: { fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, marginBottom: Spacing.md },
  label: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary, marginBottom: 6 },
  input: {
    minHeight: 52, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14,
    fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.regular, color: Colors.textPrimary,
    backgroundColor: Colors.surfaceWhite,
  },
  hint: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
  error: { marginTop: Spacing.md, color: Colors.error, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium },
});
