import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  AccessibilityInfo,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius } from "../../constants/theme";
import Button from "./Button";

type IconName = keyof typeof Ionicons.glyphMap;

// ─── Job status chip (icon + word + colour; never colour alone) ───────────────
export type BackendJobStatus =
  | "scheduled"
  | "requested"
  | "matching"
  | "assigned"
  | "partner_en_route"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_match_found";

export const TERMINAL_STATUSES: BackendJobStatus[] = ["completed", "cancelled", "no_match_found"];

const STATUS_CHIP: Record<BackendJobStatus, { label: string; icon: IconName; color: string; bg: string }> = {
  scheduled: { label: "Booked", icon: "calendar-outline", color: Colors.info, bg: Colors.infoLight },
  requested: { label: "Requested", icon: "time-outline", color: Colors.textSecondary, bg: "#F1F5F9" },
  matching: { label: "Finding a partner", icon: "radio-outline", color: Colors.warning, bg: Colors.warningLight },
  assigned: { label: "Partner assigned", icon: "person-circle-outline", color: Colors.brand700Dark, bg: Colors.brand700Light },
  partner_en_route: { label: "On the way", icon: "navigate-outline", color: Colors.info, bg: Colors.infoLight },
  in_progress: { label: "Work in progress", icon: "construct-outline", color: Colors.brand700Dark, bg: Colors.brand700Light },
  completed: { label: "Completed", icon: "checkmark-circle-outline", color: Colors.success, bg: Colors.successLight },
  cancelled: { label: "Cancelled", icon: "close-circle-outline", color: Colors.error, bg: Colors.errorLight },
  no_match_found: { label: "No partner found", icon: "alert-circle-outline", color: Colors.warning, bg: Colors.warningLight },
};

export function StatusChip({ status }: { status: string }) {
  const cfg = STATUS_CHIP[status as BackendJobStatus] ?? {
    label: status,
    icon: "ellipse-outline" as IconName,
    color: Colors.textSecondary,
    bg: "#F1F5F9",
  };
  return (
    <View style={[styles.chip, { backgroundColor: cfg.bg }]} accessible accessibilityLabel={`Status: ${cfg.label}`}>
      <Ionicons name={cfg.icon} size={14} color={cfg.color} />
      <Text style={[styles.chipText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={styles.sectionAction} hitSlop={8}>
          <Text style={styles.sectionActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Grouped list row ─────────────────────────────────────────────────────────
export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  destructive,
  last,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  const color = destructive ? Colors.error : Colors.textPrimary;
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {icon ? (
        <View style={[styles.rowIcon, destructive && { backgroundColor: Colors.errorLight }]}>
          <Ionicons name={icon} size={20} color={destructive ? Colors.error : Colors.brand700} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => ({ backgroundColor: pressed ? Colors.borderLight : "transparent" })}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

// ─── Empty and error states ───────────────────────────────────────────────────
export function EmptyState({
  icon = "file-tray-outline",
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.stateWrap}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={28} color={Colors.brand700} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: Spacing.base, width: "100%" }}>
          <Button label={actionLabel} onPress={onAction} size="md" />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message = "Something went wrong. Check your connection and try again.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.stateWrap} accessibilityRole="alert">
      <View style={[styles.stateIcon, { backgroundColor: Colors.errorLight }]}>
        <Ionicons name="cloud-offline-outline" size={28} color={Colors.error} />
      </View>
      <Text style={styles.stateTitle}>Could not load</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: Spacing.base, width: "100%" }}>
          <Button label="Try again" variant="outline" onPress={onRetry} size="md" />
        </View>
      ) : null}
    </View>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | string; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
          ])
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height, width: width as ViewStyle["width"], borderRadius: Radius.sm, backgroundColor: Colors.shimmerBase, opacity },
        style,
      ]}
    />
  );
}

// ─── Selectable chip ──────────────────────────────────────────────────────────
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.selChip, selected && styles.selChipOn]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? Colors.onPrimary : Colors.textSecondary} /> : null}
      <Text style={[styles.selChipText, selected && { color: Colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  chipText: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold },

  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.md },
  sectionTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, letterSpacing: Typography.letterSpacing.section },
  sectionAction: { minHeight: 44, justifyContent: "center" },
  sectionActionText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: Spacing.base, minHeight: 56, gap: Spacing.md },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium },
  rowSubtitle: { marginTop: 2, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, color: Colors.textSecondary },

  stateWrap: { alignItems: "center", paddingVertical: Spacing["2xl"], paddingHorizontal: Spacing.xl },
  stateIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.brand700Muted, alignItems: "center", justifyContent: "center", marginBottom: Spacing.md },
  stateTitle: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, textAlign: "center" },
  stateMessage: { marginTop: 6, fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.regular, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },

  selChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceWhite },
  selChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  selChipText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary },
});
