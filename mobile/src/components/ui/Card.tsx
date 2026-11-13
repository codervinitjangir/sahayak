import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { Colors, Radius, Shadows } from "../../constants/theme";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Adds the soft card shadow. Cards are flat with a hairline border by default. */
  elevated?: boolean;
  noPad?: boolean;
  bg?: string;
}

export default function Card({
  children,
  style,
  elevated = false,
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
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
});
