import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius, Spacing, Typography } from "../../../constants/theme";
import type { JobMessage } from "../../../services/api/jobContact";

// ADR-058. Free in-app chat between the owner and the accepted partner.
// Quick replies cover the messages people send most from the roadside.

export const QUICK_REPLIES: Record<"owner" | "partner", string[]> = {
  owner: ["I am at the pickup point", "Please call me when you arrive", "How long will you take?"],
  partner: ["On my way", "I have reached", "Running 5 minutes late"],
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export default function JobChatModal({
  visible,
  onClose,
  title,
  as,
  items,
  canSend,
  error,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  as: "owner" | "partner";
  items: JobMessage[];
  canSend: boolean;
  error: boolean;
  onSend: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<FlatList<JobMessage>>(null);

  useEffect(() => {
    if (visible && items.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
  }, [visible, items.length]);

  const send = async (body: string) => {
    const b = body.trim();
    if (!b || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await onSend(b);
      setText("");
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close chat" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
            <Text style={styles.sub}>Messages stay inside Sahayak. Your number is not shared.</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: Spacing.base, gap: Spacing.sm, flexGrow: 1 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>{error ? "Could not load messages. Retrying…" : "No messages yet. Say hello."}</Text>
              </View>
            }
            renderItem={({ item: m }) => (
              <View style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
                <Text style={[styles.body, m.mine && { color: "#fff" }]}>{m.body}</Text>
                <Text style={[styles.time, m.mine && { color: "rgba(255,255,255,0.75)" }]}>{timeOf(m.created_at)}</Text>
              </View>
            )}
          />

          {canSend ? (
            <View style={styles.composer}>
              <View style={styles.quickRow}>
                {QUICK_REPLIES[as].map((q) => (
                  <Pressable key={q} onPress={() => void send(q)} accessibilityRole="button" style={styles.quick}>
                    <Text style={styles.quickText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
              {failed ? <Text style={styles.failed}>Not sent. Check your connection and try again.</Text> : null}
              <View style={styles.inputRow}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Type a message"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={500}
                  multiline
                  accessibilityLabel="Message"
                  style={styles.input}
                />
                <Pressable
                  onPress={() => void send(text)}
                  disabled={!text.trim() || sending}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
                >
                  <Ionicons name="send" size={20} color="#fff" />
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.closed}>This job has ended. The chat is read-only.</Text>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.base, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, backgroundColor: Colors.surfaceWhite },
  iconBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  title: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textSecondary },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  emptyText: { fontSize: Typography.fontSize.base, color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.lg },
  mine: { alignSelf: "flex-end", backgroundColor: Colors.brand700, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  body: { fontSize: Typography.fontSize.base, color: Colors.textPrimary, fontFamily: Typography.fontFamily.regular, lineHeight: 21 },
  time: { marginTop: 4, fontSize: 11, color: Colors.textSecondary, alignSelf: "flex-end" },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, backgroundColor: Colors.surfaceWhite, padding: Spacing.sm, gap: Spacing.sm },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quick: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  quickText: { fontSize: Typography.fontSize.sm, color: Colors.textPrimary, fontFamily: Typography.fontFamily.medium },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm },
  input: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 12, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, fontSize: Typography.fontSize.base, color: Colors.textPrimary, fontFamily: Typography.fontFamily.regular },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.brand700, alignItems: "center", justifyContent: "center" },
  failed: { fontSize: Typography.fontSize.sm, color: Colors.error, fontFamily: Typography.fontFamily.medium },
  closed: { padding: Spacing.base, textAlign: "center", color: Colors.textSecondary, fontFamily: Typography.fontFamily.medium },
});
