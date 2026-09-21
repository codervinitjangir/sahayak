// ─── Sahayak — Card Component ─────────────────────────────────────────────────
import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { Colors, Radius, Shadows } from "../../constants/theme";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  noPad?: boolean;
  bg?: string;
}

export default function Card({
  children,
  style,
  elevated = true,
  noPad = false,
  bg = Colors.surfaceWhite,
}: CardProps) {
  return (
    <View
      style={[
        styles.card,
        elevated ? (Shadows.card as ViewStyle) : undefined,
        { backgroundColor: bg, padding: noPad ? 0 : 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
});

