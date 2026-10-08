import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "../../constants/theme";
import {
  notificationsApi,
  MobileNotificationItem,
} from "../../services/api/notifications";

interface BlinkitTopHeaderProps {
  tab: "home" | "services" | "activity";
  locationText?: string;
  etaText?: string;
  walletBalance?: string;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (text: string) => void;
  onLocationPress?: () => void;
  onWalletPress?: () => void;
  onProfilePress?: () => void;
  onSearchSubmit?: () => void;
}

export default function BlinkitTopHeader({
  tab,
  locationText = "Indiranagar 100ft Rd, HAL 2nd Stage",
  etaText = "12 minutes",
  walletBalance = "₹0",
  searchPlaceholder,
  searchQuery,
  onSearchChange,
  onLocationPress,
  onWalletPress,
  onProfilePress,
  onSearchSubmit,
}: BlinkitTopHeaderProps) {
  const insets = useSafeAreaInsets();
  const topInset =
    insets.top > 0
      ? insets.top
      : Platform.OS === "android"
      ? (StatusBar.currentHeight ?? 32)
      : 44;

  const defaultPlaceholder =
    tab === "services"
      ? 'Search "flatbed towing, jumpstart, tyre..."'
      : tab === "activity"
      ? 'Search "past orders, invoices, bills..."'
      : 'Search "mechanic, towing, flat tyre..."';

  const contextLabel =
    tab === "services"
      ? "Categories in"
      : tab === "activity"
      ? "Orders in"
      : "Sahayak in";

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<MobileNotificationItem[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState<boolean>(false);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);

  // Poll unread count every 20 seconds
  useEffect(() => {
    let isMounted = true;
    const checkCount = async () => {
      try {
        const count = await notificationsApi.getUnreadCount();
        if (isMounted) setUnreadCount(count);
      } catch {
        // keep last known count
      }
    };

    void checkCount();
    const interval = setInterval(checkCount, 20000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleOpenNotifications = async () => {
    setModalVisible(true);
    setLoadingNotifications(true);
    try {
      const res = await notificationsApi.listNotifications(20, 0);
      setNotifications(res.items);
      setUnreadCount(res.unread_count);
    } catch {
      // keep fallback empty
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    try {
      const res = await notificationsApi.markAllRead();
      setUnreadCount(res.unread_count);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.warn("Could not mark all notifications read:", err);
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleNotificationClick = async (item: MobileNotificationItem) => {
    if (!item.is_read) {
      try {
        const res = await notificationsApi.markRead(item.id);
        setUnreadCount(res.unread_count);
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
      } catch (err) {
        console.warn("Could not mark notification read:", err);
      }
    }
    setModalVisible(false);
  };

  return (
    <View style={styles.headerWrapper}>
      <LinearGradient
        colors={["#F8CB46", "#FDE068", "#FDE068", "#FEF6D8", "#F5F6F8"]}
        locations={[0, 0.35, 0.65, 0.88, 1]}
        style={[styles.gradientHeader, { paddingTop: topInset + 6 }]}
      >
        {/* ── ROW 1: Location & ETA (Left) + Wallet & Avatar (Right) ── */}
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.locationCol}
            onPress={onLocationPress}
            activeOpacity={0.8}
          >
            <Text style={styles.contextLabel}>{contextLabel}</Text>
            <Text style={styles.etaText}>{etaText}</Text>
            <View style={styles.locationPillRow}>
              <Text style={styles.locationText} numberOfLines={1}>
                {locationText}
              </Text>
              <Ionicons name="chevron-down" size={13} color="#1C1C1C" />
            </View>
          </TouchableOpacity>

          <View style={styles.rightActions}>
            {/* Wallet pill */}
            <TouchableOpacity
              style={styles.walletBadge}
              onPress={onWalletPress}
              activeOpacity={0.8}
            >
              <Ionicons name="wallet" size={15} color="#0C831F" />
              <Text style={styles.walletText}>{walletBalance}</Text>
            </TouchableOpacity>

            {/* Notification Bell with Badge */}
            <TouchableOpacity
              style={styles.bellSquircle}
              onPress={handleOpenNotifications}
              activeOpacity={0.8}
            >
              <Ionicons name="notifications-outline" size={20} color="#1C1C1C" />
              {unreadCount > 0 && (
                <View style={styles.badgePill}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Profile Squircle button matching reference */}
            <TouchableOpacity
              style={styles.profileSquircle}
              onPress={onProfilePress}
              activeOpacity={0.8}
            >
              <Ionicons name="person-outline" size={20} color="#1C1C1C" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── ROW 2: White Search Bar (Blinkit Exact) ── */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#1C1C1C" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder || defaultPlaceholder}
            placeholderTextColor="#8C93A3"
            value={searchQuery}
            onChangeText={onSearchChange}
            onSubmitEditing={onSearchSubmit}
            returnKeyType="search"
            clearButtonMode="never"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={() => onSearchChange("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#8C93A3" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity activeOpacity={0.7}>
              <Ionicons name="mic" size={18} color="#1C1C1C" />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {/* ── Notifications Modal Sheet ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>Notifications</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadCountChip}>
                    <Text style={styles.unreadCountChipText}>{unreadCount} new</Text>
                  </View>
                )}
              </View>
              <View style={styles.modalHeaderActions}>
                {unreadCount > 0 && (
                  <TouchableOpacity
                    onPress={handleMarkAllRead}
                    disabled={isMarkingAll}
                    style={styles.markAllBtn}
                  >
                    <Text style={styles.markAllText}>
                      {isMarkingAll ? "Marking..." : "Mark all read"}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={20} color="#1C1C1C" />
                </TouchableOpacity>
              </View>
            </View>

            {loadingNotifications ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color="#0C831F" />
                <Text style={styles.loadingText}>Loading notifications...</Text>
              </View>
            ) : notifications.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Ionicons name="notifications-off-outline" size={40} color="#8C93A3" />
                <Text style={styles.emptyTitle}>No notifications yet</Text>
                <Text style={styles.emptySubtitle}>
                  Job offers and status updates will appear here
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.notificationsList}>
                {notifications.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.notificationRow,
                      !item.is_read && styles.notificationRowUnread,
                    ]}
                    onPress={() => handleNotificationClick(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.notificationIconCol}>
                      <Ionicons
                        name={getEventIcon(item.event) as any}
                        size={20}
                        color={getEventColor(item.event)}
                      />
                    </View>
                    <View style={styles.notificationContentCol}>
                      <View style={styles.notificationRowTop}>
                        <Text style={styles.notificationEventText}>
                          {formatEventTitle(item.event)}
                        </Text>
                        <Text style={styles.notificationTimeText}>
                          {formatTimeAgo(item.sent_at)}
                        </Text>
                      </View>
                      <Text style={styles.notificationMessageText}>
                        {item.message || "Status updated"}
                      </Text>
                      {item.job_id && (
                        <Text style={styles.notificationJobIdText}>
                          Job ID: {item.job_id.slice(0, 8)}...
                        </Text>
                      )}
                    </View>
                    {!item.is_read && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    backgroundColor: "#F5F6F8",
    zIndex: 100,
  },
  gradientHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  locationCol: {
    flex: 1,
    paddingRight: 12,
  },
  contextLabel: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    color: "#1C1C1C",
    letterSpacing: 0.2,
    marginBottom: 1,
  },
  etaText: {
    fontSize: 24,
    fontFamily: Typography.fontFamily.extraBold,
    color: "#1C1C1C",
    letterSpacing: -0.6,
    lineHeight: 28,
    marginBottom: 3,
  },
  locationPillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  locationText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.medium,
    color: "#1C1C1C",
    maxWidth: "88%",
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
  },
  walletBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  walletText: {
    fontSize: 13,
    fontFamily: Typography.fontFamily.bold,
    color: "#1C1C1C",
  },
  bellSquircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    position: "relative",
  },
  profileSquircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    height: 46,
    paddingHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: Typography.fontFamily.regular,
    color: "#1C1C1C",
    paddingVertical: 0,
  },
  badgePill: {
    position: "absolute",
    top: -3,
    right: -3,
    backgroundColor: "#DC2626",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontFamily: Typography.fontFamily.bold,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "75%",
    minHeight: 320,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F2",
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.extraBold,
    letterSpacing: -0.4,
    color: "#1C1C1C",
  },
  unreadCountChip: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  unreadCountChipText: {
    fontSize: 11,
    fontFamily: Typography.fontFamily.bold,
    color: "#92400E",
  },
  modalHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  markAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  markAllText: {
    fontSize: 12.5,
    fontFamily: Typography.fontFamily.bold,
    color: "#0C831F",
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  modalLoading: {
    padding: 36,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#6B7280",
  },
  modalEmpty: {
    padding: 44,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1C1C1C",
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 12.5,
    color: "#6B7280",
    textAlign: "center",
    maxWidth: 240,
  },
  notificationsList: {
    paddingHorizontal: 16,
  },
  notificationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  notificationRowUnread: {
    backgroundColor: "rgba(254, 243, 199, 0.25)",
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  notificationIconCol: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  notificationContentCol: {
    flex: 1,
  },
  notificationRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  notificationEventText: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Typography.fontFamily.bold,
    color: "#1C1C1C",
  },
  notificationTimeText: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  notificationMessageText: {
    fontSize: 12.5,
    color: "#4B5563",
    lineHeight: 17,
  },
  notificationJobIdText: {
    fontSize: 10.5,
    color: "#0C831F",
    fontWeight: "600",
    marginTop: 4,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#D97706",
    marginTop: 6,
  },
});

function formatTimeAgo(isoString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "Recently";
  }
}

function formatEventTitle(event: string): string {
  switch (event) {
    case "job_offered":
      return "New Job Offer";
    case "job_assigned":
      return "Partner Assigned";
    case "partner_en_route":
      return "Partner En Route";
    case "job_in_progress":
      return "Work In Progress";
    case "job_completed":
      return "Job Completed";
    case "job_cancelled":
      return "Job Cancelled";
    case "job_no_match_found":
      return "No Partner Found";
    default:
      return event.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function getEventIcon(event: string): string {
  switch (event) {
    case "job_offered":
      return "alert-circle";
    case "job_assigned":
      return "checkmark-circle";
    case "partner_en_route":
      return "navigate";
    case "job_in_progress":
      return "construct";
    case "job_completed":
      return "checkmark-done-circle";
    case "job_cancelled":
      return "close-circle";
    default:
      return "notifications";
  }
}

function getEventColor(event: string): string {
  switch (event) {
    case "job_offered":
      return "#D97706";
    case "job_assigned":
      return "#0C831F";
    case "partner_en_route":
      return "#2563EB";
    case "job_in_progress":
      return "#4F46E5";
    case "job_completed":
      return "#059669";
    case "job_cancelled":
      return "#DC2626";
    default:
      return "#4B5563";
  }
}
