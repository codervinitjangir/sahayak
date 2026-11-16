// ─── Sahayak: floating active-request bar (owner) ─────────────────────────────
// Docked above the tab bar on every owner tab, the way ride-hailing apps keep a
// trip in view after you leave the trip screen. Two states, both from the
// owner's real job list (GET /jobs), nothing invented:
//   * a request in flight: live status, tap to track;
//   * a request that just ended with no partner (within RECENT_MISS_MS): the
//     owner may have left the search screen before it finished, so the outcome
//     is shown here instead of silently vanishing. Dismissable.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Colors, Typography, Spacing, Radius, Shadows } from "../../constants/theme";
import type { OwnerStackParamList } from "../../types";
import type { BackendJob } from "../../services/api/jobs";
import { isActiveStatus } from "../shared/ownerData";

type Nav = NativeStackNavigationProp<OwnerStackParamList>;

/** How long a "no partner found" outcome stays on the bar. */
export const RECENT_MISS_MS = 15 * 60_000;

const LIVE_COPY: Record<string, string> = {
  requested: "Finding a partner…",
  matching: "Finding a partner…",
  assigned: "Partner assigned",
  partner_en_route: "Partner on the way",
  in_progress: "Work in progress",
};

/** Pick what the bar should show from the owner's job list (newest first). */
export function pickBarJob(
  jobs: BackendJob[] | undefined,
  dismissed: ReadonlySet<string>,
  now: number = Date.now()
): { job: BackendJob; kind: "live" | "missed" } | null {
  if (!jobs?.length) return null;
  const live = jobs.find((j) => isActiveStatus(j.status));
  if (live) return { job: live, kind: "live" };
  const newest = jobs[0];
  if (
    newest.status === "no_match_found" &&
    !dismissed.has(newest.id) &&
    newest.requested_at &&
    now - new Date(newest.requested_at).getTime() < RECENT_MISS_MS
  ) {
    return { job: newest, kind: "missed" };
  }
  return null;
}

function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce || cancelled) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.8, duration: 700, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true }),
          ])
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [scale]);
  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dotHalo, { backgroundColor: color, transform: [{ scale }] }]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

export default function ActiveRequestBar({ jobs }: { jobs: BackendJob[] | undefined }) {
  const nav = useNavigation<Nav>();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const picked = pickBarJob(jobs, dismissed);
  if (!picked) return null;

  const { job, kind } = picked;
  const service = job.service_name ?? "Roadside help";
  const subtitle = [service, job.vehicle_number].filter(Boolean).join(" · ");
  const open = () => nav.navigate("OwnerFlow", { jobId: job.id });

  if (kind === "missed") {
    return (
      <View style={[styles.bar, styles.barMissed, Shadows.floating as object]}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`No partner was found for ${service}. See options.`}
          style={styles.main}
        >
          <View style={[styles.iconWrap, { backgroundColor: Colors.warningLight }]}>
            <Ionicons name="alert-circle" size={22} color={Colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>No partner found</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
          <Text style={[styles.cta, { color: Colors.warning }]}>See options</Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissed((prev) => new Set(prev).add(job.id))}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>
    );
  }

  const searching = job.status === "requested" || job.status === "matching";
  const eta = job.current_assignment?.estimated_arrival_min;
  const title =
    job.status === "partner_en_route" && eta != null
      ? `Partner on the way · ${eta} min`
      : LIVE_COPY[job.status] ?? "Request in progress";

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}. Track your request.`}
      style={({ pressed }) => [styles.bar, styles.barLive, Shadows.floating as object, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.main}>
        <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
          <PulseDot color={searching ? "#FCD34D" : "#FFFFFF"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: Colors.textWhite }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.subtitle, { color: "rgba(255,255,255,0.75)" }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        <View style={styles.trackBtn}>
          <Text style={styles.trackText}>Track</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primaryDeep} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.lg,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
  },
  barLive: { backgroundColor: Colors.primaryDeep },
  barMissed: {
    backgroundColor: Colors.surfaceWhite,
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
    minHeight: 64,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dotWrap: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  dotHalo: { position: "absolute", width: 14, height: 14, borderRadius: 7, opacity: 0.35 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: {
    fontSize: Typography.fontSize.base,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  cta: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold },
  trackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radius.full,
    paddingLeft: 14,
    paddingRight: 10,
    minHeight: 36,
  },
  trackText: {
    fontSize: Typography.fontSize.sm,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primaryDeep,
  },
  close: { width: 48, height: 64, alignItems: "center", justifyContent: "center" },
});
