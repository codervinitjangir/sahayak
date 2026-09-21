// ─── Sahayak — Service Grid Component ────────────────────────────────────────
// 2x3 grid of service categories — core of the owner home screen
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Typography, Spacing, Radius, Shadows } from "../../constants/theme";
import { ServiceConfig, type ServiceType } from "../../constants/theme";
import type { ViewStyle } from "react-native";

interface ServiceGridProps {
  onSelect: (service: ServiceType) => void;
}

const SERVICES: ServiceType[] = [
  "towing",
  "battery",
  "tyre",
  "fuel",
  "lockout",
  "mechanic",
];

export default function ServiceGrid({ onSelect }: ServiceGridProps) {
  return (
    <View style={styles.grid}>
      {SERVICES.map((key) => {
        const cfg = ServiceConfig[key];
        return (
          <TouchableOpacity
            key={key}
            style={styles.item}
            onPress={() => onSelect(key)}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: cfg.bg },
                Shadows.card as ViewStyle,
              ]}
            >
              <Ionicons
                name={cfg.icon as any}
                size={26}
                color={cfg.color}
              />
            </View>
            <Text style={styles.label}>{cfg.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  item: {
    width: "31%",
    alignItems: "center",
    marginBottom: Spacing.base,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
    backgroundColor: Colors.primaryLight,
  },
  label: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
    textAlign: "center",
  },
});

