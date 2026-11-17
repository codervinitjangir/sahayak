// Payment receipt for a completed job, for the owner and the assigned partner.
// GET /payments/job/{jobId} finds the payment; GET /payments/{id}/receipt gives
// the receipt once it is paid. It is a receipt, never a "tax invoice": Sahayak
// is not GST-registered yet, so no tax line is shown or invented.
import React from "react";
import { View, Text, ScrollView, StyleSheet, Share, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Colors, Radius, Spacing, Typography } from "../../constants/theme";
import ScreenHero from "../../components/ui/ScreenHero";
import Button from "../../components/ui/Button";
import LogoMark from "../../components/brand/LogoMark";
import { ErrorState, EmptyState } from "../../components/ui/kit";
import { paymentsApi, type PaymentReceipt, type PaymentRecord } from "../../services/api/payments";

type Params = { Receipt: { jobId: string } };

const METHOD: Record<string, string> = { upi: "UPI", cash: "Cash", card: "Card", netbanking: "Net banking" };

function rupees(v: number | string | null | undefined) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function when(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ReceiptScreen() {
  const nav = useNavigation();
  const { jobId } = useRoute<RouteProp<Params, "Receipt">>().params;

  const payment = useQuery<PaymentRecord | null>({
    queryKey: ["payment", jobId],
    queryFn: async () => {
      try {
        return await paymentsApi.getJobPayment(jobId);
      } catch (e: any) {
        if (e?.response?.status === 404) return null; // no payment opened yet
        throw e;
      }
    },
  });
  const settled = payment.data && (payment.data.status === "paid" || payment.data.status === "refunded");
  const receipt = useQuery<PaymentReceipt>({
    queryKey: ["receipt", payment.data?.id],
    queryFn: () => paymentsApi.getReceipt(payment.data!.id),
    enabled: Boolean(settled),
  });

  const share = (r: PaymentReceipt) =>
    void Share.share({
      title: `Sahayak receipt ${r.receipt_number}`,
      message: [
        `Sahayak receipt ${r.receipt_number}`,
        `${r.service_name ?? "Roadside service"}${r.vehicle_number ? ` · ${r.vehicle_number}` : ""}`,
        r.partner_name ? `Partner: ${r.partner_name}` : null,
        `Amount: ${rupees(r.amount)} (${r.status === "refunded" ? "refunded" : "paid"}${r.payment_method ? `, ${METHOD[r.payment_method] ?? r.payment_method}` : ""})`,
        `Paid: ${when(r.paid_at)}`,
        r.payment_reference ? `Reference: ${r.payment_reference}` : null,
        "This is a payment receipt, not a tax invoice.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

  let body: React.ReactNode;
  if (payment.isLoading || (settled && receipt.isLoading)) {
    body = <ActivityIndicator style={{ marginTop: 48 }} color={Colors.brand700} />;
  } else if (payment.isError || receipt.isError) {
    body = <ErrorState message="We could not load this receipt." onRetry={() => void (payment.isError ? payment.refetch() : receipt.refetch())} />;
  } else if (!payment.data) {
    body = <EmptyState icon="receipt-outline" title="No payment yet" message="The receipt appears here once the partner records the payment." />;
  } else if (!settled) {
    body = (
      <EmptyState
        icon="hourglass-outline"
        title={payment.data.status === "failed" ? "Payment failed" : "Payment pending"}
        message={`${rupees(payment.data.amount)} is waiting to be confirmed by the partner. The receipt appears once it is paid.`}
      />
    );
  } else if (receipt.data) {
    const r = receipt.data;
    const refunded = r.status === "refunded";
    body = (
      <>
        <View style={styles.card}>
          <View style={styles.head}>
            <LogoMark size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.brand}>Sahayak</Text>
              <Text style={styles.muted}>Payment receipt</Text>
            </View>
            <View style={[styles.stamp, refunded && { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name={refunded ? "arrow-undo" : "checkmark-circle"} size={14} color={refunded ? "#B45309" : "#15803D"} />
              <Text style={[styles.stampText, refunded && { color: "#B45309" }]}>{refunded ? "Refunded" : "Paid"}</Text>
            </View>
          </View>

          <View style={styles.amountBox}>
            <Text style={styles.muted}>Amount</Text>
            <Text style={styles.amount}>{rupees(r.amount)}</Text>
            <Text style={styles.muted}>{r.payment_method ? `via ${METHOD[r.payment_method] ?? r.payment_method}` : ""}</Text>
          </View>

          <View style={styles.dash} />
          <Row label="Receipt no." value={r.receipt_number} mono />
          <Row label="Service" value={r.service_name ?? "Roadside service"} />
          {r.vehicle_number ? <Row label="Vehicle" value={r.vehicle_number} mono /> : null}
          {r.partner_name ? <Row label="Partner" value={r.partner_name} /> : null}
          {r.pickup_address ? <Row label="Location" value={r.pickup_address} /> : null}
          <View style={styles.dash} />
          {r.completed_at ? <Row label="Job completed" value={when(r.completed_at)} /> : null}
          <Row label="Paid on" value={when(r.paid_at)} />
          {r.payment_reference ? <Row label="Reference" value={r.payment_reference} mono /> : null}
          <View style={styles.dash} />
          <Text style={styles.foot}>This is a payment receipt, not a tax invoice.</Text>
        </View>
        <Button label="Share receipt" icon="share-outline" onPress={() => share(r)} />
      </>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHero title="Receipt" left={{ icon: "chevron-back", onPress: () => nav.goBack(), label: "Back" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && { letterSpacing: 0.6 }]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.screenHorizontal, gap: Spacing.lg, paddingBottom: 48 },
  card: { backgroundColor: Colors.surfaceWhite, borderRadius: Radius["2xl"], padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  brand: { fontSize: Typography.fontSize.lg, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  muted: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  stamp: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#DCFCE7" },
  stampText: { fontSize: Typography.fontSize.sm, fontFamily: Typography.fontFamily.bold, color: "#15803D" },
  amountBox: { alignItems: "center", paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.xl, gap: 2 },
  amount: { fontSize: 36, fontFamily: Typography.fontFamily.bold, color: Colors.textPrimary },
  dash: { borderBottomWidth: 1.5, borderStyle: "dashed", borderColor: Colors.border, marginVertical: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.base },
  rowLabel: { fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.regular, color: Colors.textMuted },
  rowValue: { flex: 1, textAlign: "right", fontSize: Typography.fontSize.base, fontFamily: Typography.fontFamily.semiBold, color: Colors.textPrimary },
  foot: { textAlign: "center", fontSize: Typography.fontSize.xs, color: Colors.textMuted, fontFamily: Typography.fontFamily.regular },
});
