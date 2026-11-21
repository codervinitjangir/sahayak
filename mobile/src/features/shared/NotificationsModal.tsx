import React, { useMemo } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Modal,
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing, Radius } from "../../constants/theme";
import {
  notificationsApi,
  type MobileNotificationItem,
  type MobileNotificationListResponse,
} from "../../services/api/notifications";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/kit";
import { QK, useNotifications, useUnreadCount } from "./ownerData";
import { useAuthStore } from "../../store/authStore";
import { notificationMeta, routeForNotification, type NotificationTone } from "../../services/notificationMeta";
import { openNotificationRoute } from "../../navigation/navigationRef";
import { AUTO_READ_DELAY_MS, allRead, cleared, unreadIds, withoutNotification } from "./notificationPanel";

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

type Section = { title: string; data: MobileNotificationItem[] };
type ListUpdater = (l: MobileNotificationListResponse | undefined) => MobileNotificationListResponse | undefined;

// One row. Memoised so clearing one row, or the read flags flipping after the
// auto-read, does not re-render the whole list on a low-end phone.
const Row = React.memo(function Row({
  n,
  isNew,
  tappable,
  onOpen,
  onDismiss,
}: {
  n: MobileNotificationItem;
  isNew: boolean;
  tappable: boolean;
  onOpen: (n: MobileNotificationItem) => void;
  onDismiss: (id: string) => void;
}) {
  const meta = notificationMeta(n.event);
  const tone = TONE[meta.tone];
  return (
    <View style={[styles.item, isNew && styles.itemNew]}>
      {isNew ? <View style={styles.newBar} /> : null}
      <Pressable
        onPress={() => onOpen(n)}
        disabled={!tappable}
        accessibilityRole={tappable ? "button" : "text"}
        accessibilityLabel={`${meta.title}. ${n.message ?? ""}${isNew ? ". New" : ""}`}
        style={({ pressed }) => [styles.itemBody, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
          <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={20} color={tone.fg} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.itemTop}>
            <Text style={[styles.itemTitle, isNew && { fontFamily: Typography.fontFamily.bold }]} numberOfLines={1}>
              {meta.title}
            </Text>
            <Text style={styles.when}>{timeLabel(n.sent_at)}</Text>
          </View>
          {n.message ? <Text style={styles.msg} numberOfLines={2}>{n.message}</Text> : null}
          {tappable ? <Text style={styles.open}>Open</Text> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={() => onDismiss(n.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Clear ${meta.title}`}
        style={styles.dismiss}
      >
        <Ionicons name="close" size={18} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
});

export default function NotificationsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // ADR-054. The panel slides in from the right like a screen: one native-driver
  // timing on translateX. The old version grew out of the bell with a spring on
  // scale + x + y + opacity over a full list, which dropped frames on low-end
  // Android, and its two close paths (the X animated, the parent's state change
  // did not) made closing feel different every time. Now every close goes
  // through `visible` turning false.
  const { width } = useWindowDimensions();
  const anim = React.useRef(new Animated.Value(0)).current;
  const [shown, setShown] = React.useState(visible);
  const shownRef = React.useRef(visible);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);
  React.useEffect(() => {
    if (visible) {
      shownRef.current = true;
      setShown(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: reduceMotion ? 0 : 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (shownRef.current) {
      Animated.timing(anim, {
        toValue: 0,
        duration: reduceMotion ? 0 : 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        shownRef.current = false;
        setShown(false);
      });
    }
  }, [visible, anim, reduceMotion]);

  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const list = useNotifications(true);
  const role = useAuthStore((s) => s.user?.role);

  const setList = React.useCallback(
    (fn: ListUpdater) => qc.setQueryData<MobileNotificationListResponse>(QK.notifications, fn),
    [qc],
  );
  const resync = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK.unread });
    void qc.invalidateQueries({ queryKey: QK.notifications });
  }, [qc]);

  // Show what is cached at once, and fetch anything newer underneath.
  const { refetch } = list;
  React.useEffect(() => {
    if (visible) void refetch();
  }, [visible, refetch]);
  // Keep the closed panel warm: when the badge (already polled by the home
  // screen, same query) goes up, fetch the list then, not when the bell is tapped.
  const badge = useUnreadCount().data ?? 0;
  const lastBadge = React.useRef(badge);
  React.useEffect(() => {
    if (badge > lastBadge.current) void refetch();
    lastBadge.current = badge;
  }, [badge, refetch]);

  // Rows that were unread when the panel opened keep their "new" look for this
  // visit, even after the auto-read below has cleared the badge.
  const [newIds, setNewIds] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    if (!visible || !list.data) return;
    const fresh = unreadIds(list.data);
    if (fresh.size === 0) return;
    setNewIds((prev) => new Set([...prev, ...fresh]));
    // Opening the panel is reading it: marked after a short beat, then the
    // badge and the cached list are updated without another fetch.
    const t = setTimeout(() => {
      notificationsApi
        .markAllRead()
        .then(() => {
          qc.setQueryData(QK.unread, 0);
          setList(allRead);
        })
        .catch(() => undefined); // a convenience; the badge simply stays
    }, AUTO_READ_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, list.data, qc, setList]);
  React.useEffect(() => {
    if (!shown) setNewIds(new Set());
  }, [shown]);

  const dismiss = React.useCallback(
    (id: string) => {
      setList((l) => withoutNotification(l, id));
      notificationsApi
        .dismiss(id)
        .then((r) => qc.setQueryData(QK.unread, r.unread_count))
        .catch(resync); // the row comes back if the server did not take it
    },
    [qc, setList, resync],
  );

  const clearAll = () => {
    Alert.alert("Clear all notifications?", "They will be removed from this list.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: () => {
          setList(cleared);
          qc.setQueryData(QK.unread, 0);
          notificationsApi.clearAll().catch(resync);
        },
      },
    ]);
  };

  const openItem = React.useCallback(
    (n: MobileNotificationItem) => {
      const target = routeForNotification(role, n.event, n.job_id);
      if (!target) return;
      onClose();
      openNotificationRoute(target);
    },
    [role, onClose],
  );

  const sections = useMemo(() => {
    const out: Section[] = [];
    for (const n of list.data?.items ?? []) {
      const title = dayLabel(n.sent_at);
      const last = out[out.length - 1];
      if (last && last.title === title) last.data.push(n);
      else out.push({ title, data: [n] });
    }
    return out;
  }, [list.data]);

  const hasItems = (list.data?.items.length ?? 0) > 0;
  const newCount = newIds.size;

  return (
    <Modal visible={shown} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View
        renderToHardwareTextureAndroid
        style={[
          styles.root,
          { paddingTop: insets.top },
          { transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] },
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notifications" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">Notifications</Text>
            {newCount > 0 ? <Text style={styles.headerSub}>{newCount} new</Text> : null}
          </View>
          {hasItems ? (
            <Pressable onPress={clearAll} accessibilityRole="button" accessibilityLabel="Clear all notifications" style={styles.clearAll}>
              <Text style={styles.clearAllText}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>

        {list.isLoading ? (
          <View style={{ padding: Spacing.screenHorizontal, gap: Spacing.md }}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        ) : list.isError && !list.data ? (
          <ErrorState message="We could not load your notifications." onRetry={() => void list.refetch()} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(n) => n.id}
            stickySectionHeadersEnabled={false}
            initialNumToRender={8}
            windowSize={5}
            contentContainerStyle={{ paddingHorizontal: Spacing.base, paddingBottom: insets.bottom + Spacing.xl, flexGrow: 1 }}
            refreshControl={
              <RefreshControl refreshing={visible && list.isRefetching} onRefresh={() => void list.refetch()} tintColor={Colors.brand700} />
            }
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
            renderItem={({ item: n }) => (
              <Row
                n={n}
                isNew={newIds.has(n.id)}
                tappable={!!routeForNotification(role, n.event, n.job_id)}
                onOpen={openItem}
                onDismiss={dismiss}
              />
            )}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    minHeight: 60,
    backgroundColor: Colors.surfaceWhite,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  iconBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  title: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium, color: Colors.brand700, marginTop: 1 },
  clearAll: { minHeight: 48, paddingHorizontal: Spacing.md, alignItems: "center", justifyContent: "center" },
  clearAllText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
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
    alignItems: "flex-start",
    minHeight: 72,
    marginBottom: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  itemNew: { borderColor: Colors.brand700Light, backgroundColor: "#FBFFFE" },
  newBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: Colors.brand700 },
  itemBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md },
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
  open: { marginTop: 4, fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  when: { fontSize: Typography.fontSize.xs, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
  dismiss: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});
