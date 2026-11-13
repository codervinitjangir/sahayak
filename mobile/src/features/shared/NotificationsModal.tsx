import React from "react";
import { Modal, View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Typography, Spacing } from "../../constants/theme";
import { notificationsApi } from "../../services/api/notifications";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/kit";
import { QK, useNotifications, formatWhen } from "./ownerData";

export default function NotificationsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const list = useNotifications(visible);

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

  const hasUnread = (list.data?.unread_count ?? 0) > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notifications" style={styles.close}>
            <Ionicons name="close" size={26} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            Notifications
          </Text>
          {hasUnread ? (
            <Pressable onPress={markAll} accessibilityRole="button" style={styles.markAll}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          ) : (
            <View style={{ width: 96 }} />
          )}
        </View>

        {list.isLoading ? (
          <View style={{ padding: Spacing.screenHorizontal, gap: Spacing.md }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </View>
        ) : list.isError ? (
          <ErrorState message="We could not load your notifications." onRetry={() => void list.refetch()} />
        ) : (
          <FlatList
            data={list.data?.items ?? []}
            keyExtractor={(n) => n.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
            ListEmptyComponent={<EmptyState icon="notifications-outline" title="You are all caught up" message="Updates about your requests will appear here." />}
            renderItem={({ item: n }) => (
              <Pressable
                onPress={() => !n.is_read && void markRead(n.id)}
                accessibilityRole="button"
                accessibilityLabel={`${n.message ?? n.event}${n.is_read ? "" : ", unread"}`}
                style={[styles.item, !n.is_read && styles.itemUnread]}
              >
                <View style={[styles.dot, { backgroundColor: n.is_read ? "transparent" : Colors.brand700 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.msg}>{n.message ?? n.event.replace(/_/g, " ")}</Text>
                  <Text style={styles.when}>{formatWhen(n.sent_at)}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surfaceWhite },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.sm, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  title: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  markAll: { width: 96, minHeight: 48, alignItems: "flex-end", justifyContent: "center", paddingRight: Spacing.sm },
  markAllText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.brand700 },
  item: { flexDirection: "row", gap: Spacing.md, padding: Spacing.base, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  itemUnread: { backgroundColor: Colors.brand700Muted },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  msg: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.medium, color: Colors.textPrimary, lineHeight: 22 },
  when: { marginTop: 3, fontSize: Typography.fontSize.sm, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
});
