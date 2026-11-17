import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Typography } from "../../constants/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export interface TabDef<T extends string> {
  key: T;
  label: string;
  icon: IconName;
  iconActive: IconName;
  /** Small count badge, e.g. unread notifications. Hidden when 0 or undefined. */
  badge?: number;
}

/** Height the floating bar occupies, so scroll content can pad past it. */
export const TAB_BAR_SPACE = 104;

/**
 * Floating frosted bar of round buttons; the active tab is a solid black circle.
 * Labels are not drawn (the reference is icon-only) but every tab keeps its
 * accessible name, and the active one shows its label under the circle row.
 */
export default function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  center,
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
  /** Raised middle button (the fifth slot), e.g. "Get help". */
  center?: { icon: IconName; label: string; onPress: () => void };
}) {
  const mid = center ? Math.ceil(tabs.length / 2) : -1;
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {tabs.map((t, idx) => {
          const on = t.key === active;
          return (
            <React.Fragment key={t.key}>
            {idx === mid && center ? (
              <Pressable
                onPress={center.onPress}
                accessibilityRole="button"
                accessibilityLabel={center.label}
                style={({ pressed }) => [styles.center, pressed && { transform: [{ scale: 0.94 }] }]}
              >
                <Ionicons name={center.icon} size={28} color="#fff" />
                <Text style={styles.centerText}>{center.label}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onChange(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.badge ? `${t.label}, ${t.badge} new` : t.label}
              style={({ pressed }) => [styles.tab, on ? styles.tabOn : styles.tabOff, pressed && !on && { opacity: 0.7 }]}
            >
              <Ionicons name={on ? t.iconActive : t.icon} size={22} color={on ? "#fff" : Colors.textPrimary} />
              {t.badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{t.badge > 9 ? "9+" : t.badge}</Text>
                </View>
              ) : null}
            </Pressable>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  bar: {
    flexDirection: "row",
    gap: 8,
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 20 },
      android: { elevation: 10 },
      default: { boxShadow: "0 8px 28px rgba(0,0,0,0.16)", backdropFilter: "blur(16px)" } as object,
    }),
  },
  tab: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#111111" },
  center: { width: 72, height: 72, marginTop: -26, borderRadius: 36, backgroundColor: Colors.emergency, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#fff", elevation: 8, shadowColor: Colors.emergency, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  centerText: { color: "#fff", fontSize: 10, fontFamily: Typography.fontFamily.bold, marginTop: -2 },
  tabOff: { backgroundColor: "#F1F2F4" },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.emergency,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: Typography.fontFamily.bold },
});
