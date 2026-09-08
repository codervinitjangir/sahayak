import React from "react";
import { View, Text, StyleSheet } from "react-native";

// TODO: Show map with nearby partners + "Request Help" CTA
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.subtitle}>Request roadside assistance — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  subtitle: { fontSize: 14, color: "#94a3b8", marginTop: 8 },
});
