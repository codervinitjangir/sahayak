// ─── Sahayak — Button Component ───────────────────────────────────────────────
import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Colors, Typography, Spacing, Radius, Shadows } from "../../constants/theme";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
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
}

const sizeConfig: Record<ButtonSize, { height: number; fontSize: number; px: number }> = {
  sm: { height: 40, fontSize: Typography.fontSize.sm, px: Spacing.base },
  md: { height: 50, fontSize: Typography.fontSize.base, px: Spacing.lg },
  lg: { height: 56, fontSize: Typography.fontSize.md, px: Spacing.xl },
};

const variantStyles = {
  primary: {
    bg: Colors.primary,
    text: Colors.textWhite,
    border: "transparent",
    shadow: true,
  },
  secondary: {
    bg: Colors.secondary,
    text: Colors.textWhite,
    border: "transparent",
    shadow: false,
  },
  ghost: {
    bg: "transparent",
    text: Colors.textSecondary,
    border: "transparent",
    shadow: false,
  },
  danger: {
    bg: Colors.error,
    text: Colors.textWhite,
    border: "transparent",
    shadow: false,
  },
  outline: {
    bg: "transparent",
    text: Colors.primary,
    border: Colors.primary,
    shadow: false,
  },
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
}: ButtonProps) {
  const sz = sizeConfig[size];
  const vr = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.82}
      style={[
        styles.base,
        {
          height: sz.height,
          backgroundColor: vr.bg,
          borderColor: vr.border,
          borderWidth: variant === "outline" ? 1.5 : 0,
          paddingHorizontal: sz.px,
          width: fullWidth ? "100%" : undefined,
          opacity: isDisabled ? 0.55 : 1,
        },
        vr.shadow ? (Shadows.button as ViewStyle) : undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? Colors.textWhite : Colors.primary}
        />
      ) : (
        <View style={styles.inner}>
          {icon && iconPosition === "left" && (
            <View style={styles.iconLeft}>{icon}</View>
          )}
          <Text
            style={[
              styles.label,
              {
                fontSize: sz.fontSize,
                color: vr.text,
              },
              textStyle,
            ]}
          >
            {label}
          </Text>
          {icon && iconPosition === "right" && (
            <View style={styles.iconRight}>{icon}</View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
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
    fontFamily: Typography.fontFamily.semiBold,
    letterSpacing: Typography.letterSpacing.wide,
  },
  iconLeft: { marginRight: Spacing.sm },
  iconRight: { marginLeft: Spacing.sm },
});

