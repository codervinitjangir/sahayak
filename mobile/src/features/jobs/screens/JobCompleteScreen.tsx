// ─── Sahayak — Job Complete Screen ────────────────────────────────────────────
// Figma: owner-job-complete — success splash, review card, cost breakdown, rating, tip
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  StatusBar,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import type { RouteProp } from "@react-navigation/native";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../../constants/theme";
import Avatar from "../../../components/ui/Avatar";
import RatingStars from "../../../components/ui/RatingStars";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import { MOCK_PARTNER } from "../../../services/api";
import type { OwnerStackParamList } from "../../../types";

type Nav = NativeStackNavigationProp<OwnerStackParamList, "JobComplete">;
type Route = RouteProp<OwnerStackParamList, "JobComplete">;

const TIP_OPTIONS = [0, 20, 50, 100];

export default function JobCompleteScreen() {
  const nav = useNavigation<Nav>();
  const partner = MOCK_PARTNER;

  const [rating, setRating] = useState(0);
  const [tip, setTip] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 7,
      }),
      Animated.timing(checkAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleDone = () => {
    if (rating === 0) {
      Alert.alert("Rate the service", "Please give a rating before finishing.");
      return;
    }
    setSubmitted(true);
    setTimeout(() => nav.popToTop(), 1500);
  };

  const totalAmount = 299 + tip;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Success Splash (Figma: success-splash) ── */}
        <View style={styles.splash}>
          <Animated.View style={[styles.successCircle, { transform: [{ scale: scaleAnim }] }]}>
            <Ionicons name="checkmark" size={48} color={Colors.textWhite} />
          </Animated.View>
          <Text style={styles.successTitle}>Service Complete!</Text>
          <Text style={styles.successSubtitle}>
            Your vehicle is back on the road 🎉
          </Text>
        </View>

        {/* ── Partner Review Card (Figma: partner-review-card) ── */}
        <Card style={styles.partnerCard}>
          <View style={styles.partnerRow}>
            <Avatar name={partner.name} size={52} />
            <View style={styles.partnerInfo}>
              <Text style={styles.partnerName}>{partner.name}</Text>
              <Text style={styles.partnerSub}>Mechanic · {partner.totalJobs} jobs done</Text>
            </View>
            <View style={styles.partnerBadge}>
              <Ionicons name="shield-checkmark" size={14} color={Colors.info} />
              <Text style={styles.partnerBadgeText}>Verified</Text>
            </View>
          </View>
        </Card>

        {/* ── Cost Breakdown (Figma: cost-breakdown) ── */}
        <Card style={styles.costCard}>
          <Text style={styles.sectionTitle}>Payment Summary</Text>
          {[
            { label: "Jump Start Service", amount: 299 },
            { label: "Platform Fee", amount: 0, note: "FREE" },
            { label: "Tip for Partner", amount: tip },
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
          <View style={styles.costDivider} />
          <View style={styles.costRow}>
            <Text style={styles.costTotal}>Total Paid</Text>
            <Text style={styles.costTotalAmount}>₹{totalAmount}</Text>
          </View>
          <View style={[styles.paymentBadge]}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
            <Text style={styles.paymentBadgeText}>Cash on delivery</Text>
          </View>
        </Card>

        {/* ── Rating (Figma: rating-section) ── */}
        <Card style={styles.ratingCard}>
          <Text style={styles.sectionTitle}>Rate the Service</Text>
          <Text style={styles.ratingSubtitle}>
            How was your experience with {partner.name}?
          </Text>
          <View style={styles.starsRow}>
            <RatingStars value={rating} onChange={setRating} size={38} />
          </View>
          {rating > 0 && (
            <Text style={styles.ratingFeedback}>
              {["", "Poor", "Fair", "Good", "Great", "Excellent! ⭐"][rating]}
            </Text>
          )}
        </Card>

        {/* ── Tip Section (Figma: tip-section) ── */}
        <Card style={styles.tipCard}>
          <Text style={styles.sectionTitle}>Add a Tip</Text>
          <Text style={styles.tipSubtitle}>Show appreciation for great service</Text>
          <View style={styles.tipOptions}>
            {TIP_OPTIONS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tipBtn, tip === t && styles.tipBtnSelected]}
                onPress={() => setTip(t)}
              >
                <Text style={[styles.tipBtnText, tip === t && styles.tipBtnTextSelected]}>
                  {t === 0 ? "No tip" : `₹${t}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Done Panel (Figma: done-panel) ── */}
      <View style={[styles.donePanel, { ...(Shadows.sheet as object) }]}>
        <Button
          label={submitted ? "✓ Submitted!" : "Done & Submit Rating"}
          onPress={handleDone}
          variant={submitted ? "ghost" : "primary"}
          disabled={submitted}
          size="lg"
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
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceWhite,
    marginBottom: Spacing.sm,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.success,
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
    textAlign: "center",
  },

  partnerCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  partnerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  partnerInfo: { flex: 1 },
  partnerName: {
    fontSize: Typography.fontSize.lg,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  partnerSub: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 2,
  },
  partnerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  partnerBadgeText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.info,
    fontFamily: Typography.fontFamily.semiBold,
  },

  costCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, gap: 10 },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
    marginBottom: 2,
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
    color: Colors.textPrimary,
    fontFamily: Typography.fontFamily.medium,
  },
  costFree: {
    fontSize: Typography.fontSize.sm,
    color: Colors.success,
    fontFamily: Typography.fontFamily.semiBold,
  },
  costDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  costTotal: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  costTotalAmount: {
    fontSize: Typography.fontSize["2xl"],
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  paymentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  paymentBadgeText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.success,
    fontFamily: Typography.fontFamily.semiBold,
  },

  ratingCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, alignItems: "center", gap: 6 },
  ratingSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    textAlign: "center",
  },
  starsRow: { paddingVertical: Spacing.sm },
  ratingFeedback: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.semiBold,
    color: Colors.primary,
  },

  tipCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, gap: 6 },
  tipSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Typography.fontFamily.regular,
    marginBottom: 4,
  },
  tipOptions: { flexDirection: "row", gap: 8 },
  tipBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    backgroundColor: Colors.surface,
  },
  tipBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  tipBtnText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.medium,
    color: Colors.textSecondary,
  },
  tipBtnTextSelected: {
    color: Colors.primary,
    fontFamily: Typography.fontFamily.bold,
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

