// ─── Shared screen template: the dark hero header ─────────────────────────────
// Every top-level screen (owner tabs, partner tabs, flows) opens with this:
// a dark block with rounded bottom corners, a top bar (left action · centred
// title · right action), an optional greeting, and an optional frosted pill
// (search-style call to action) that sits at the bottom of the hero.
import React from "react";
import { View, Text, Pressable, StyleSheet, StatusBar, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Hero } from "../../constants/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export interface HeroAction {
  icon: IconName;
  onPress: () => void;
  label: string;
  /** Small red dot, e.g. unread notifications. */
  dot?: boolean;
}

export function HeroIconButton({ icon, onPress, label, dot }: HeroAction) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: Hero.glassBorder }]}
    >
      <Ionicons name={icon} size={22} color="#fff" />
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

/** Frosted pill used inside the hero: icon · two lines · round white action. */
export function HeroPill({
  title,
  subtitle,
  icon = "search",
  actionIcon = "options-outline",
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  actionIcon?: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.pillIcon}>
        <Ionicons name={icon} size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pillTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.pillSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={styles.pillAction}>
        <Ionicons name={actionIcon} size={20} color={Colors.textPrimary} />
      </View>
    </Pressable>
  );
}

export default function ScreenHero({
  title,
  greeting,
  subtitle,
  left,
  right,
  children,
  center = true,
  style,
}: {
  /** Centred in the top bar (e.g. "Sahayak", "Activity"). */
  title: string;
  /** Large white line under the bar, e.g. "Hello, Riya". */
  greeting?: string;
  subtitle?: string;
  left?: HeroAction | React.ReactNode;
  right?: HeroAction | React.ReactNode;
  /** Usually a HeroPill or a status row. */
  children?: React.ReactNode;
  /** Centre the big text block (Deals-style) instead of left-aligning it. */
  center?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const slot = (a: HeroAction | React.ReactNode): React.ReactNode => {
    if (a && typeof a === "object" && "icon" in a && "onPress" in a) return <HeroIconButton {...(a as HeroAction)} />;
    return (a as React.ReactNode) ?? <View style={styles.iconBtnGhost} />;
  };

  return (
    <View style={[styles.hero, { paddingTop: insets.top + 6 }, style]}>
      <StatusBar barStyle="light-content" />
      {/* Soft light blooms stand in for the photo backdrop of the reference. */}
      <View pointerEvents="none" style={styles.bloomA} />
      <View pointerEvents="none" style={styles.bloomB} />

      <View style={styles.bar}>
        {slot(left)}
        <Text style={styles.barTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {slot(right)}
      </View>

      {greeting || subtitle ? (
        <View style={[styles.textBlock, center && !children && { alignItems: "center" }]}>
          {greeting ? <Text style={[styles.greeting, center && !children && { textAlign: "center" }]}>{greeting}</Text> : null}
          {subtitle ? <Text style={[styles.subtitle, center && !children && { textAlign: "center" }]}>{subtitle}</Text> : null}
        </View>
      ) : null}

      {children ? <View style={{ marginTop: Spacing.base }}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: Hero.bg,
    borderBottomLeftRadius: Hero.radius,
    borderBottomRightRadius: Hero.radius,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingBottom: Spacing.xl,
    overflow: "hidden",
  },
  bloomA: { position: "absolute", top: -120, right: -90, width: 280, height: 280, borderRadius: 140, backgroundColor: "#FFFFFF", opacity: 0.07 },
  bloomB: { position: "absolute", bottom: -110, left: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: "#FFFFFF", opacity: 0.04 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  barTitle: { flex: 1, textAlign: "center", color: "#fff", fontSize: Typography.fontSize["2xl"], fontFamily: Typography.fontFamily.semiBold },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  iconBtnGhost: { width: 44, height: 44 },
  dot: { position: "absolute", top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.emergency, borderWidth: 1.5, borderColor: Hero.bg },
  textBlock: { marginTop: Spacing.md },
  greeting: { color: "#fff", fontSize: Typography.fontSize["4xl"], fontFamily: Typography.fontFamily.medium, lineHeight: 34 },
  subtitle: { marginTop: 4, color: Hero.textSoft, fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, lineHeight: 19 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minHeight: 64,
    paddingLeft: Spacing.base,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: Hero.glass,
    borderWidth: 1,
    borderColor: Hero.glassBorder,
  },
  pillIcon: { width: 28, alignItems: "center" },
  pillTitle: { color: "#fff", fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.medium },
  pillSub: { marginTop: 1, color: Hero.textSoft, fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular },
  pillAction: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
