// ─── Slot picker (ADR-050) ────────────────────────────────────────────────────
// Day chips, then the two-hour slots of that day, all from GET /jobs/schedule-slots.
// Failure is a state: an error with a retry, never an invented list of times.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";

import { Colors, Typography, Spacing } from "../../../constants/theme";
import { Chip, ErrorState, Skeleton } from "../../../components/ui/kit";
import { jobsApi } from "../../../services/api/jobs";
import { groupByDay, timeLabel, type ScheduleSlot } from "../schedule";
import { useTranslation } from "../../../i18n";

export default function SlotPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (slot: ScheduleSlot | null) => void;
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
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const days = useMemo(() => groupByDay(slots ?? []), [slots]);
  const current = days.find((d) => d.day === day) ?? days[0];

  if (failed) return <ErrorState message={t("booking.slotsFailed")} onRetry={load} />;
  if (!slots) return <Skeleton height={48} />;
  if (!days.length) return <Text style={styles.note}>{t("booking.noneNow")}</Text>;

  return (
    <View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t("booking.day")}>
        {days.map((d) => (
          <Chip key={d.day} label={d.day} selected={current?.day === d.day} onPress={() => { setDay(d.day); onChange(null); }} />
        ))}
      </View>
      <View style={[styles.chips, { marginTop: Spacing.sm }]} accessibilityRole="radiogroup" accessibilityLabel={t("booking.time")}>
        {current?.slots.map((s) => (
          <Chip
            key={s.start}
            icon="time-outline"
            label={`${timeLabel(s.start)}-${timeLabel(s.end)}`}
            selected={value === s.start}
            onPress={() => onChange(s)}
          />
        ))}
      </View>
      {leadMin != null ? (
        <Text style={styles.note}>{t("booking.leadNote", { min: leadMin })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  note: { marginTop: Spacing.sm, fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontFamily: Typography.fontFamily.regular, lineHeight: 20 },
});
