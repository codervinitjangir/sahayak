import React from "react";
import { View, Text, StyleSheet } from "react-native";

// TODO: Live map tracking mechanic ETA using expo-location + react-native-maps
export default function TrackingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Tracking 📍</Text>
      <Text style={styles.subtitle}>Mechanic location on map — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  subtitle: { fontSize: 14, color: "#94a3b8", marginTop: 8 },
});
