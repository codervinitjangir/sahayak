// ─── Slot picker (ADR-050) ────────────────────────────────────────────────────
// A row of day cards, then that day's two-hour slots as a grid, all from
// GET /jobs/schedule-slots. Failure is a state: an error with a retry, never an
// invented list of times.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";

import { Colors, Typography, Spacing, Radius } from "../../../constants/theme";
import { ErrorState, Skeleton } from "../../../components/ui/kit";
import { jobsApi } from "../../../services/api/jobs";
import { groupByDay, timeLabel, type ScheduleSlot } from "../schedule";
import { useTranslation } from "../../../i18n";

/** "Sun 23 Nov" → ["Sun", "23", "Nov"]. */
export function dayParts(day: string): [string, string, string] {
  const [dow = "", date = "", month = ""] = day.split(" ");
  return [dow, date, month];
}

export default function SlotPicker({
  value,
  onChange,
  onLeadMinutes,
}: {
  value: string | null;
  onChange: (slot: ScheduleSlot | null) => void;
  onLeadMinutes?: (min: number) => void;
}) {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<ScheduleSlot[] | null>(null);
  const [leadMin, setLeadMin] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    setSlots(null);
    jobsApi
      .getScheduleSlots()
      .then((r) => {
        setSlots(r.slots);
        setLeadMin(r.release_lead_min);
        onLeadMinutes?.(r.release_lead_min);
      })
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const days = useMemo(() => groupByDay(slots ?? []), [slots]);
  const current = days.find((d) => d.day === day) ?? days[0];

  if (failed) return <ErrorState message={t("booking.slotsFailed")} onRetry={load} />;
  if (!slots) return <Skeleton height={120} />;
  if (!days.length) return <Text style={styles.note}>{t("booking.noneNow")}</Text>;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("booking.day")}
      >
        {days.map((d) => {
          const [dow, date, month] = dayParts(d.day);
          const on = current?.day === d.day;
          return (
            <Pressable
              key={d.day}
              onPress={() => {
                setDay(d.day);
                onChange(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={d.day}
              style={[styles.dayCard, on && styles.dayOn]}
            >
              <Text style={[styles.dow, on && styles.onText]}>{dow.toUpperCase()}</Text>
              <Text style={[styles.date, on && styles.onText]}>{date}</Text>
              <Text style={[styles.month, on && styles.onText]}>{month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t("booking.time")}>
        {current?.slots.map((s) => {
          const on = value === s.start;
          return (
            <Pressable
              key={s.start}
              onPress={() => onChange(s)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${timeLabel(s.start)} to ${timeLabel(s.end)}`}
              style={[styles.slot, on && styles.slotOn]}
            >
              <Text style={[styles.slotText, on && styles.onText]}>
                {timeLabel(s.start)} – {timeLabel(s.end)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {leadMin != null && !onLeadMinutes ? <Text style={styles.note}>{t("booking.leadNote", { min: leadMin })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  days: { gap: Spacing.sm, paddingVertical: 2 },
  dayCard: {
    width: 64,
    minHeight: 76,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
  },
  dayOn: { backgroundColor: Colors.brand700, borderColor: Colors.brand700 },
  dow: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.semiBold, color: Colors.textSecondary, letterSpacing: 0.6 },
  date: { fontSize: Typography.fontSize.xl, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary, marginVertical: 1 },
  month: { fontSize: Typography.fontSize.xs, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  onText: { color: "#fff" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.md },
  slot: {
    minHeight: 48,
    minWidth: "47%",
    flexGrow: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceWhite,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  slotOn: { backgroundColor: Colors.brand700, borderColor: Colors.brand700 },
  slotText: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  note: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 20 },
});
