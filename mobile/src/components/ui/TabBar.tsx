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
export const TAB_BAR_SPACE = 96;

/**
 * Floating frosted pill. Every slot is an icon over a label; the active tab sits
 * in a soft grey bubble. An optional `center` action (e.g. SOS) takes the middle
 * slot with the same size as the tabs, drawn in the emergency colour.
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
  center?: { icon: IconName; label: string; onPress: () => void };
}) {
  const mid = center ? Math.ceil(tabs.length / 2) : -1;
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 10) }]}>
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
                  style={({ pressed }) => [styles.slot, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.sosIcon}>
                    <Ionicons name={center.icon} size={20} color="#fff" />
                  </View>
                  <Text style={[styles.label, { color: Colors.emergency, fontFamily: Typography.fontFamily.bold }]}>{center.label}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onChange(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.badge ? `${t.label}, ${t.badge} new` : t.label}
                style={({ pressed }) => [styles.slot, on && styles.slotOn, pressed && !on && { opacity: 0.6 }]}
              >
                <Ionicons name={on ? t.iconActive : t.icon} size={22} color={on ? Colors.textPrimary : "#4B5563"} />
                <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{t.label}</Text>
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
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    padding: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 18 },
      android: { elevation: 12 },
      default: { boxShadow: "0 8px 28px rgba(0,0,0,0.14)", backdropFilter: "blur(16px)" } as object,
    }),
  },
  slot: { flex: 1, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", gap: 2 },
  slotOn: { backgroundColor: "#EEF0F3" },
  label: { fontSize: 11.5, fontFamily: Typography.fontFamily.medium, color: "#4B5563" },
  labelOn: { color: Colors.textPrimary, fontFamily: Typography.fontFamily.bold },
  sosIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.emergency, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 4,
    right: "22%",
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
