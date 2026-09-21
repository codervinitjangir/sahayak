// ─── Sahayak — Rating Stars Component ────────────────────────────────────────
import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../../constants/theme";

interface RatingStarsProps {
  value?: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
}

export default function RatingStars({
  value = 0,
  onChange,
  size = 28,
  readonly = false,
}: RatingStarsProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          disabled={readonly}
          onPress={() => onChange?.(star)}
          onPressIn={() => setHovered(star)}
          onPressOut={() => setHovered(0)}
          activeOpacity={0.7}
          style={{ marginHorizontal: 3 }}
        >
          <Ionicons
            name={display >= star ? "star" : "star-outline"}
            size={size}
            color={display >= star ? Colors.primary : Colors.shimmerBase}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});

