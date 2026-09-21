// ─── Sahayak — Profile Screen ─────────────────────────────────────────────────
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Avatar from "../../../components/ui/Avatar";
import Card from "../../../components/ui/Card";
import Button from "../../../components/ui/Button";
import { useAuthStore } from "../../../store/authStore";

const MENU_ITEMS = [
  { icon: "car-outline", label: "My Vehicles", sub: "Manage registered vehicles" },
  { icon: "location-outline", label: "Saved Addresses", sub: "Home, Work & more" },
  { icon: "receipt-outline", label: "Payment Methods", sub: "UPI, Cards, Wallet" },
  { icon: "document-text-outline", label: "Request History", sub: "All past service requests" },
  { icon: "notifications-outline", label: "Notifications", sub: "Alerts & reminders" },
  { icon: "help-circle-outline", label: "Help & Support", sub: "FAQ, Chat, Call us" },
  { icon: "shield-outline", label: "Privacy Policy", sub: "" },
  { icon: "information-circle-outline", label: "About Sahayak", sub: "v1.0.0" },
];

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.screenTitle}>Profile</Text>
        </View>

        {/* Profile card */}
        <Card style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Avatar name={user?.name ?? "U"} size={64} />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.name ?? "User"}</Text>
              <Text style={styles.profilePhone}>{user?.phone}</Text>
              <View style={styles.roleBadge}>
                <Ionicons
                  name={user?.role === "partner" ? "construct-outline" : "car-outline"}
                  size={12}
                  color={Colors.primary}
                />
                <Text style={styles.roleText}>
                  {user?.role === "partner" ? "Service Partner" : "Vehicle Owner"}
                </Text>
              </View>
            </View>
            <TouchableOpacity>
              <Ionicons name="pencil-outline" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {user?.role === "owner" && (
            <View style={styles.statsRow}>
              {[
                { label: "Requests", value: user.totalJobs ?? 0 },
                { label: "Rating", value: `${user.rating ?? "—"}⭐` },
                { label: "Member Since", value: "Sep 2026" },
              ].map((s) => (
                <View key={s.label} style={styles.statItem}>
                  <Text style={styles.statValue}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Menu items */}
        <Card style={styles.menuCard} noPad>
          {MENU_ITEMS.map((item, i) => (
            <React.Fragment key={item.label}>
              <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
                <View style={styles.menuIcon}>
                  <Ionicons name={item.icon as any} size={20} color={Colors.textSecondary} />
                </View>
                <View style={styles.menuText}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  {item.sub ? <Text style={styles.menuSub}>{item.sub}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              {i < MENU_ITEMS.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
          ))}
        </Card>

        <View style={{ paddingHorizontal: Spacing.lg, marginBottom: 32 }}>
          <Button
            label="Log Out"
            onPress={handleLogout}
            variant="outline"
            textStyle={{ color: Colors.error }}
            style={{ borderColor: Colors.error }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { paddingBottom: 20 },

  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  screenTitle: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },

  profileCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: Typography.fontSize.xl,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  profilePhone: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginBottom: 6,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.full,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  roleText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary,
    fontFamily: Typography.fontFamily.semiBold,
  },
  statsRow: {
    flexDirection: "row",
    paddingTop: Spacing.base,
    marginTop: Spacing.base,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
  },

  menuCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.base },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.base,
    gap: 12,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: { flex: 1 },
  menuLabel: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  menuSub: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textMuted,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 1,
  },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginLeft: 64 },
});

