import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
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

/** Bottom tab bar. Four tabs, labels always visible, 56dp tall plus the safe area. */
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
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.badge ? `${t.label}, ${t.badge} new` : t.label}
            style={styles.tab}
          >
            <View>
              <Ionicons name={on ? t.iconActive : t.icon} size={24} color={on ? Colors.brand700 : Colors.textMuted} />
              {t.badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{t.badge > 9 ? "9+" : t.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: Colors.surfaceWhite,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: 6,
  },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium, color: Colors.textMuted },
  labelOn: { color: Colors.brand700, fontFamily: Typography.fontFamily.semiBold },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
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
