// ─── Sahayak — Avatar Component ───────────────────────────────────────────────
import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Colors, Typography, Radius } from "../../constants/theme";

interface AvatarProps {
  name?: string;
  uri?: string;
  size?: number;
  showOnline?: boolean;
  isOnline?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
    "#EF4444", "#F97316", "#06B6D4", "#EC4899",
  ];
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function Avatar({
  name = "?",
  uri,
  size = 44,
  showOnline = false,
  isOnline = false,
}: AvatarProps) {
  const dotSize = Math.round(size * 0.28);

  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[
            styles.image,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
          ]}
        />
      ) : (
        <View
          style={[
            styles.initials,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: getAvatarColor(name),
            },
          ]}
        >
          <Text
            style={[
              styles.initialsText,
              { fontSize: size * 0.38 },
            ]}
          >
            {getInitials(name)}
          </Text>
        </View>
      )}

      {showOnline && (
        <View
          style={[
            styles.onlineDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: isOnline ? Colors.online : Colors.offline,
              bottom: 0,
              right: 0,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    resizeMode: "cover",
  },
  initials: {
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    color: Colors.textWhite,
    fontFamily: Typography.fontFamily.bold,
  },
  onlineDot: {
    position: "absolute",
    borderWidth: 2,
    borderColor: Colors.surfaceWhite,
  },
});

