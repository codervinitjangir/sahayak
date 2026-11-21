// ─── Move or cancel a booking (ADR-050) ──────────────────────────────────────
// Only while the job is still 'scheduled'. The server answers 409
// JOB_NOT_SCHEDULED once matching has started; that is shown in plain words.
import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { Colors, Typography, Spacing } from "../../../constants/theme";
import Button from "../../../components/ui/Button";
import { showDialog } from "../../../components/ui/AppDialog";
import { jobsApi, type BackendJob } from "../../../services/api/jobs";
import { QK } from "../../shared/ownerData";
import SlotPicker from "./SlotPicker";
import { slotLabel, type ScheduleSlot } from "../schedule";

import { bookingError, useTranslation } from "../../../i18n";

export const codeOf = (e: any): string | undefined => e?.response?.data?.error?.code;

export default function BookingActions({ job, onDone }: { job: BackendJob; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const move = async () => {
    if (!slot) return;
    setBusy(true);
    setErr(null);
    try {
      await jobsApi.reschedule(job.id, slot.start);
      await qc.invalidateQueries({ queryKey: QK.jobs });
      showDialog(t("booking.moved"), t("booking.movedBody", { slot: slot.label }));
      onDone();
    } catch (e) {
      setErr(bookingError(codeOf(e)) ?? t("booking.moveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    showDialog(t("booking.cancelTitle"), t("booking.cancelBody", { slot: slotLabel(job.scheduled_for, job.slot_end) }), [
      { text: t("booking.keepBooking"), style: "cancel" },
      {
        text: t("booking.yesCancel"),
        style: "destructive",
        onPress: async () => {
          try {
            await jobsApi.cancelJob(job.id, "Booking cancelled by owner");
            await qc.invalidateQueries({ queryKey: QK.jobs });
            onDone();
          } catch {
            setErr(t("booking.cancelFailed"));
          }
        },
      },
    ]);

  return (
    <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
      {moving ? (
        <>
          <Text style={styles.sub}>{t("booking.pickNew")}</Text>
          <SlotPicker value={slot?.start ?? null} onChange={setSlot} />
          <Button label={t("booking.move")} onPress={move} loading={busy} disabled={!slot} />
          <Button label={t("booking.keep")} variant="ghost" onPress={() => setMoving(false)} disabled={busy} />
        </>
      ) : (
        <>
          <Button label={t("booking.moveOther")} onPress={() => setMoving(true)} />
          <Button label={t("booking.cancel")} variant="outline" onPress={cancel} />
        </>
      )}
      {err ? <Text style={styles.err} accessibilityLiveRegion="polite">{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: Typography.fontSize.md, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  err: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.semiBold, color: Colors.error },
});
