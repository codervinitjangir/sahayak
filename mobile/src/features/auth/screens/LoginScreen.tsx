import React from "react";
import { View, Text, StyleSheet } from "react-native";

// TODO: Replace with real login form (phone OTP via Supabase Auth)
export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Sahayak 🔧</Text>
      <Text style={styles.subtitle}>Login screen — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  subtitle: { fontSize: 14, color: "#94a3b8", marginTop: 8 },
});
