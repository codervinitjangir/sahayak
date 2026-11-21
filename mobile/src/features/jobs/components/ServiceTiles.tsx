// The "what do you need?" step as big one-tap tiles instead of a wall of chips.
// Prices are shown only when the catalogue has one (base_price), never invented.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Radius, ServiceConfig, Spacing, Typography } from "../../../constants/theme";
import type { ServiceType } from "../../../types";
import type { MobileCatalogService } from "../../../services/api/services";

/** "from ₹399", or null when the catalogue has no price for it. */
export function fromPrice(base: number | string | null | undefined): string | null {
  if (base === null || base === undefined || base === "") return null;
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `from ₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function ServiceTiles({
  services,
  groupOf,
  value,
  onChange,
}: {
  services: MobileCatalogService[];
  groupOf: (code: string) => ServiceType | undefined;
  value: string | null;
  onChange: (code: string) => void;
}) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="What do you need?">
      {services.map((s) => {
        const cfg = ServiceConfig[groupOf(s.code) ?? "mechanic"];
        const on = value === s.code;
        const price = fromPrice(s.base_price);
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${s.name}${price ? `, ${price}` : ""}`}
            style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.9 }]}
          >
            <View style={[styles.icon, { backgroundColor: on ? "rgba(255,255,255,0.14)" : cfg.bg }]}>
              <Ionicons name={cfg.icon as keyof typeof Ionicons.glyphMap} size={22} color={on ? "#fff" : cfg.color} />
            </View>
            <Text style={[styles.name, on && styles.onText]} numberOfLines={2}>
              {s.name}
            </Text>
            {price ? <Text style={[styles.price, on && styles.onSub]}>{price}</Text> : null}
            {on ? (
              <View style={styles.check}>
                <Ionicons name="checkmark" size={14} color={Colors.brand700} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  tile: {
    width: "48.5%",
    minHeight: 104,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
    gap: 6,
  },
  tileOn: { backgroundColor: Colors.brand700, borderColor: Colors.brand700 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  name: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary, lineHeight: 20 },
  price: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.medium, color: Colors.textSecondary },
  onText: { color: "#fff" },
  onSub: { color: "rgba(255,255,255,0.8)" },
  check: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
