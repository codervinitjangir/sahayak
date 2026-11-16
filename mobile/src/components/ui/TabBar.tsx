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
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key}
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
  tab: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#111111" },
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
