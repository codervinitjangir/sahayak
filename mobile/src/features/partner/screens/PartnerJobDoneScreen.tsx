// ─── Sahayak — Partner Job Done Screen ───────────────────────────────────────
// Figma: partner-job-done — success, earnings summary, rating earned
import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import RatingStars from "../../../components/ui/RatingStars";
import type { PartnerStackParamList } from "../../../types";

type Nav = NativeStackNavigationProp<PartnerStackParamList, "PartnerJobDone">;

export default function PartnerJobDoneScreen() {
  const nav = useNavigation<Nav>();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 55,
        friction: 7,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Success Splash ── */}
        <View style={styles.splash}>
          <Animated.View
            style={[styles.successCircle, { transform: [{ scale: scaleAnim }] }]}
          >
            <Ionicons name="checkmark" size={48} color={Colors.textWhite} />
          </Animated.View>
          <Text style={styles.successTitle}>Job Complete!</Text>
          <Text style={styles.successSubtitle}>Great work, Ravi! 🎉</Text>
        </View>

        {/* ── Earnings Card ── */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <Card style={styles.earningsCard} bg={Colors.secondary}>
            <Text style={styles.earningsLabel}>You earned</Text>
            <Text style={styles.earningsAmount}>₹299</Text>
            <Text style={styles.earningsNote}>Jump Start Service · Today</Text>
            <View style={styles.earningsStats}>
              <View style={styles.earnStat}>
                <Text style={styles.earnStatVal}>5</Text>
                <Text style={styles.earnStatLbl}>Jobs Today</Text>
              </View>
              <View style={styles.earnDivider} />
              <View style={styles.earnStat}>
                <Text style={styles.earnStatVal}>₹1,748</Text>
                <Text style={styles.earnStatLbl}>Today's Total</Text>
              </View>
              <View style={styles.earnDivider} />
              <View style={styles.earnStat}>
                <Text style={styles.earnStatVal}>4.9⭐</Text>
                <Text style={styles.earnStatLbl}>Rating</Text>
              </View>
            </View>
          </Card>

          {/* ── Customer Review ── */}
          <Card style={styles.reviewCard}>
            <Text style={styles.sectionTitle}>Customer gave you</Text>
            <View style={styles.reviewRow}>
              <RatingStars value={5} size={28} readonly />
              <Text style={styles.reviewStarLabel}>5 Stars!</Text>
            </View>
            <Text style={styles.reviewQuote}>
              "Very professional and fast. Fixed the issue quickly. Highly recommended!"
            </Text>
          </Card>

          {/* ── Cost Breakdown ── */}
          <Card style={styles.breakdownCard}>
            <Text style={styles.sectionTitle}>Earnings Breakdown</Text>
            {[
              { label: "Service Charge", amount: 299 },
              { label: "Tip from Customer", amount: 50 },
              { label: "Platform Commission (0%)", amount: 0, note: "FREE" },
            ].map((row) => (
              <View key={row.label} style={styles.costRow}>
                <Text style={styles.costLabel}>{row.label}</Text>
                {row.note ? (
                  <Text style={styles.costFree}>{row.note}</Text>
                ) : (
                  <Text style={styles.costAmount}>₹{row.amount}</Text>
                )}
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.costRow}>
              <Text style={styles.totalLabel}>Total Earned</Text>
              <Text style={styles.totalAmount}>₹349</Text>
            </View>
          </Card>
        </Animated.View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Done Panel ── */}
      <View style={[styles.donePanel, Shadows.sheet as object]}>
        <Button
          label="Back to Dashboard"
          onPress={() => nav.popToTop()}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { paddingBottom: 20 },

  splash: {
    alignItems: "center",
    paddingTop: Spacing["3xl"],
    paddingBottom: Spacing["2xl"],
    backgroundColor: Colors.surfaceWhite,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  successTitle: {
    fontSize: Typography.fontSize["3xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  successSubtitle: {
    fontSize: Typography.fontSize.base,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },

  earningsCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    alignItems: "center",
    gap: 4,
  },
  earningsLabel: {
    fontSize: Typography.fontSize.base,
    color: "rgba(255,255,255,0.7)",
    fontFamily: Typography.fontFamily.regular,
  },
  earningsAmount: {
    fontSize: 48,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
    lineHeight: 56,
  },
  earningsNote: {
    fontSize: Typography.fontSize.sm,
    color: "rgba(255,255,255,0.6)",
    fontFamily: Typography.fontFamily.regular,
    marginBottom: Spacing.base,
  },
  earningsStats: {
    flexDirection: "row",
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
    paddingTop: Spacing.sm,
  },
  earnStat: { flex: 1, alignItems: "center", gap: 4 },
  earnStatVal: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textWhite,
  },
  earnStatLbl: {
    fontSize: Typography.fontSize.xs,
    color: "rgba(255,255,255,0.6)",
    fontFamily: Typography.fontFamily.regular,
  },
  earnDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.15)" },

  reviewCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: 10,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reviewStarLabel: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
  },
  reviewQuote: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    fontStyle: "italic",
    lineHeight: 22,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },

  breakdownCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: 10,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  costLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
  },
  costAmount: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textPrimary,
  },
  costFree: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.success,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  totalLabel: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  totalAmount: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.success,
  },

  donePanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceWhite,
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
  },
});

