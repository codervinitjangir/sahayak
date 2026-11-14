// In-app replacement for the OS Alert dialog. Same call shape as Alert.alert, so
// `showDialog(title, message, buttons)` is a drop-in, but it is drawn with the
// design system (Inter, brand colours, 48dp buttons) on every platform, including
// the web preview where Alert.alert is a no-op.
//
// Mount <AppDialogHost /> once at the app root. Calls made while a dialog is open
// are queued, never stacked or dropped.
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { create } from "zustand";

import { Colors, Radius, Spacing, TouchTarget, Typography } from "../../constants/theme";

export interface DialogButton {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

export type DialogTone = "info" | "error" | "danger";

interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  tone: DialogTone;
}

interface DialogState {
  queue: DialogRequest[];
  push: (r: DialogRequest) => void;
  shift: () => void;
}

const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

let nextId = 1;

const ERROR_WORDS = /\b(could not|couldn't|failed|error|unable|invalid|not allowed|expired)\b/i;

/** Tone from content: a destructive action is a danger confirm; failure wording is an error. */
export function inferTone(title: string, message: string | undefined, buttons: DialogButton[]): DialogTone {
  if (buttons.some((b) => b.style === "destructive")) return "danger";
  if (ERROR_WORDS.test(title) || (buttons.length <= 1 && ERROR_WORDS.test(message ?? ""))) return "error";
  return "info";
}

/** Order for display: cancel first (left), the main action last (right), as on both OSes. */
export function orderButtons(buttons: DialogButton[] | undefined): DialogButton[] {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: "OK" }];
  return [...list.filter((b) => b.style === "cancel"), ...list.filter((b) => b.style !== "cancel")];
}

export function showDialog(title: string, message?: string, buttons?: DialogButton[]): void {
  const ordered = orderButtons(buttons);
  useDialogStore.getState().push({
    id: nextId++,
    title,
    message,
    buttons: ordered,
    tone: inferTone(title, message, ordered),
  });
}

const TONE = {
  info: { icon: "information-circle" as const, fg: Colors.primary, bg: Colors.primaryMuted },
  error: { icon: "alert-circle" as const, fg: Colors.error, bg: "#FEF2F2" },
  danger: { icon: "warning" as const, fg: Colors.error, bg: "#FEF2F2" },
};

export function AppDialogHost() {
  const current = useDialogStore((s) => s.queue[0]);
  const shift = useDialogStore((s) => s.shift);

  const close = (button?: DialogButton) => {
    shift();
    // Run after the state update so an action that opens another dialog queues behind this one.
    if (button?.onPress) setTimeout(button.onPress, 0);
  };

  if (!current) return null;
  const tone = TONE[current.tone];
  const cancel = current.buttons.find((b) => b.style === "cancel");
  const stacked = current.buttons.length > 2;

  return (
    <Modal
      key={current.id}
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close(cancel ?? current.buttons[0])}
    >
      <View style={styles.backdrop}>
        {/* Tapping outside dismisses only when there is a cancel choice to fall back on. */}
        {cancel && <Pressable style={StyleSheet.absoluteFill} onPress={() => close(cancel)} accessible={false} />}
        <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
          <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={28} color={tone.fg} />
          </View>
          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}

          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {current.buttons.map((b, i) => {
              const isCancel = b.style === "cancel";
              const isDanger = b.style === "destructive";
              const isPrimary = !isCancel && i === current.buttons.length - 1;
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => close(b)}
                  accessibilityRole="button"
                  accessibilityLabel={b.text ?? "OK"}
                  style={({ pressed }) => [
                    styles.btn,
                    !stacked && styles.btnFlex,
                    isDanger
                      ? styles.btnDanger
                      : isPrimary
                        ? styles.btnPrimary
                        : styles.btnSecondary,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.btnText,
                      isDanger || isPrimary ? styles.btnTextOn : styles.btnTextSecondary,
                    ]}
                    numberOfLines={1}
                  >
                    {b.text ?? "OK"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radius.xl,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    alignItems: "center",
    elevation: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.xl,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  message: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.base,
    lineHeight: Typography.fontSize.base * 1.5,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  actions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg, alignSelf: "stretch" },
  actionsStacked: { flexDirection: "column-reverse" },
  btn: {
    minHeight: TouchTarget,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.base,
  },
  btnFlex: { flex: 1 },
  btnPrimary: { backgroundColor: Colors.primary },
  btnDanger: { backgroundColor: Colors.error },
  btnSecondary: { backgroundColor: Colors.surfaceWhite, borderWidth: 1, borderColor: Colors.border },
  btnText: { fontFamily: Typography.fontFamily.semiBold, fontSize: Typography.fontSize.base },
  btnTextOn: { color: Colors.textWhite },
  btnTextSecondary: { color: Colors.textPrimary },
});
