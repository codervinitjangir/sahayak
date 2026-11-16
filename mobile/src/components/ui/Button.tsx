import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Colors, Typography, Spacing, Radius, Shadows } from "../../constants/theme";

// "brand" and "secondary" are kept as aliases so older call sites keep compiling.
type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline"
  | "brand"
  | "emergency";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  onPress: () => void;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

// Every size meets the 48dp touch target except `sm`, which is for secondary
// inline actions and still clears WCAG 2.2's 24px minimum with room to spare.
const sizeConfig: Record<ButtonSize, { height: number; fontSize: number; px: number }> = {
  sm: { height: 44, fontSize: Typography.fontSize.sm, px: Spacing.base },
  md: { height: 48, fontSize: Typography.fontSize.base, px: Spacing.lg },
  lg: { height: 56, fontSize: Typography.fontSize.md, px: Spacing.xl },
};

const variantStyles = {
  primary: { bg: Colors.primary, pressed: Colors.primaryDark, text: Colors.onPrimary, border: "transparent", shadow: true },
  brand: { bg: Colors.primary, pressed: Colors.primaryDark, text: Colors.onPrimary, border: "transparent", shadow: true },
  secondary: { bg: Colors.surfaceWhite, pressed: Colors.borderLight, text: Colors.textPrimary, border: Colors.border, shadow: false },
  ghost: { bg: "transparent", pressed: Colors.borderLight, text: Colors.textSecondary, border: "transparent", shadow: false },
  danger: { bg: Colors.error, pressed: "#991B1B", text: Colors.textWhite, border: "transparent", shadow: false },
  emergency: { bg: Colors.emergency, pressed: Colors.error, text: Colors.textWhite, border: "transparent", shadow: false },
  outline: { bg: "transparent", pressed: Colors.primaryMuted, text: Colors.primary, border: Colors.primary, shadow: false },
};

export default function Button({
  onPress,
  label,
  variant = "primary",
  size = "lg",
  loading = false,
  disabled = false,
  icon,
  iconPosition = "left",
  fullWidth = true,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) {
  const sz = sizeConfig[size];
  const vr = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sz.height,
          backgroundColor: pressed && !isDisabled ? vr.pressed : vr.bg,
          borderColor: vr.border,
          borderWidth: vr.border === "transparent" ? 0 : 1.5,
          paddingHorizontal: sz.px,
          width: fullWidth ? "100%" : undefined,
          opacity: isDisabled ? 0.55 : 1,
        },
        undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={vr.text} />
      ) : (
        <View style={styles.inner}>
          {icon && iconPosition === "left" && <View style={styles.iconLeft}>{icon}</View>}
          <Text style={[styles.label, { fontSize: sz.fontSize, color: vr.text }, textStyle]}>
            {label}
          </Text>
          {icon && iconPosition === "right" && <View style={styles.iconRight}>{icon}</View>}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: Typography.fontFamily.medium,
  },
  iconLeft: { marginRight: Spacing.sm },
  iconRight: { marginLeft: Spacing.sm },
});
