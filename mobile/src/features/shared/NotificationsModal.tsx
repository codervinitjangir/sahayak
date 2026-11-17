import React, { useMemo } from "react";
import { Animated, Modal, View, Text, SectionList, Pressable, StyleSheet, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing, Radius } from "../../constants/theme";
import { notificationsApi, type MobileNotificationItem } from "../../services/api/notifications";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/kit";
import { QK, useNotifications } from "./ownerData";
import { useAuthStore } from "../../store/authStore";
import { notificationMeta, routeForNotification, type NotificationTone } from "../../services/notificationMeta";
import { openNotificationRoute } from "../../navigation/navigationRef";

const TONE: Record<NotificationTone, { fg: string; bg: string }> = {
  brand: { fg: Colors.brand700, bg: Colors.brand700Light },
  success: { fg: Colors.success, bg: Colors.successLight },
  warning: { fg: Colors.warning, bg: Colors.warningLight },
  danger: { fg: Colors.error, bg: Colors.errorLight },
  info: { fg: Colors.info, bg: Colors.infoLight },
};

/** "Today" / "Yesterday" / "12 Nov". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function NotificationsModal({ visible, onClose: onCloseProp }: { visible: boolean; onClose: () => void }) {
  // Opens from the bell: the panel grows out of the top-right corner.
  const anim = React.useRef(new Animated.Value(0)).current;
  const [shown, setShown] = React.useState(visible);
  React.useEffect(() => {
    if (visible) {
      setShown(true);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();
    } else {
      setShown(false);
    }
  }, [visible, anim]);
  const onClose = () =>
    Animated.timing(anim, { toValue: 0, duration: 170, useNativeDriver: true }).start(() => {
      setShown(false);
      onCloseProp();
    });
  const panelStyle = {
    opacity: anim,
    transform: [
      { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [140, 0] }) },
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-220, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
    ],
  };
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const list = useNotifications(visible);
  const role = useAuthStore((s) => s.user?.role);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: QK.unread });
    await qc.invalidateQueries({ queryKey: QK.notifications });
  };

  const markRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      await refresh();
    } catch {
      // Marking as read is a convenience; the list simply stays as it was.
    }
  };

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      await refresh();
    } catch {
      /* same as above */
    }
  };

  const open = (n: MobileNotificationItem) => {
    if (!n.is_read) void markRead(n.id);
    const target = routeForNotification(role, n.event, n.job_id);
    if (target) {
      onClose();
      openNotificationRoute(target);
    }
  };

  const sections = useMemo(() => {
    const out: { title: string; data: MobileNotificationItem[] }[] = [];
    for (const n of list.data?.items ?? []) {
      const title = dayLabel(n.sent_at);
      const last = out[out.length - 1];
      if (last && last.title === title) last.data.push(n);
      else out.push({ title, data: [n] });
    }
    return out;
  }, [list.data]);

  const unreadCount = list.data?.unread_count ?? 0;

  return (
    <Modal visible={shown} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(15,23,42,0.4)", opacity: anim }]} />
      <Animated.View style={[styles.root, { paddingTop: insets.top }, panelStyle]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notifications" style={styles.close}>
            <Ionicons name="close" size={26} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.title} accessibilityRole="header">Notifications</Text>
            {unreadCount > 0 ? <Text style={styles.headerSub}>{unreadCount} unread</Text> : null}
          </View>
          {unreadCount > 0 ? (
            <Pressable onPress={markAll} accessibilityRole="button" accessibilityLabel="Mark all as read" style={styles.markAll}>
              <Ionicons name="checkmark-done" size={22} color={Colors.brand700} />
            </Pressable>
          ) : (
            <View style={styles.markAll} />
          )}
        </View>

        {list.isLoading ? (
          <View style={{ padding: Spacing.screenHorizontal, gap: Spacing.md }}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        ) : list.isError ? (
          <ErrorState message="We could not load your notifications." onRetry={() => void list.refetch()} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(n) => n.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.base, paddingBottom: insets.bottom + Spacing.xl, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={Colors.brand700} />}
            ListEmptyComponent={
              <View style={{ flex: 1, justifyContent: "center", paddingVertical: 64 }}>
                <EmptyState
                  icon="notifications-outline"
                  title="You are all caught up"
                  message={role === "partner" ? "New offers and job updates will appear here." : "Updates about your requests will appear here."}
                />
              </View>
            }
            renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
            renderItem={({ item: n }) => {
              const meta = notificationMeta(n.event);
              const tone = TONE[meta.tone];
              const tappable = !!routeForNotification(role, n.event, n.job_id);
              return (
                <Pressable
                  onPress={() => open(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${meta.title}. ${n.message ?? ""}${n.is_read ? "" : ". Unread"}`}
                  style={({ pressed }) => [styles.item, !n.is_read && styles.itemUnread, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
                    <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={tone.fg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemTitle, !n.is_read && { fontFamily: Typography.fontFamily.bold }]} numberOfLines={1}>
                        {meta.title}
                      </Text>
                      <Text style={styles.when}>{timeLabel(n.sent_at)}</Text>
                    </View>
                    {n.message ? <Text style={styles.msg} numberOfLines={2}>{n.message}</Text> : null}
                  </View>
                  {!n.is_read ? <View style={styles.unreadDot} /> : tappable ? (
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface, borderTopLeftRadius: 0, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    minHeight: 60,
    backgroundColor: Colors.surfaceWhite,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  title: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium, color: Colors.brand700, marginTop: 1 },
  markAll: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  section: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: 4,
    fontSize: Typography.fontSize.xs,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    minHeight: 72,
    marginBottom: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemUnread: { borderColor: Colors.brand700Light, backgroundColor: "#FBFFFE" },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemTitle: {
    flex: 1,
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.textPrimary,
  },
  msg: {
    marginTop: 2,
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  when: { fontSize: Typography.fontSize.xs, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.brand700 },
});
