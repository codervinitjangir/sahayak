import { apiClient } from "./client";

export type PaymentMethod = "upi" | "cash" | "card" | "netbanking";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface PaymentRecord {
  id: string;
  job_id: string;
  amount: number | string | null;
  status: PaymentStatus;
  payment_method?: PaymentMethod | null;
  gateway_ref_id?: string | null;
  upi_intent?: string | null;
  created_at: string;
}

export const paymentsApi = {
  /** Get current payment status for a job (GET /api/v1/payments/job/{jobId}) */
  getJobPayment: (jobId: string) =>
    apiClient.get<PaymentRecord>(`/payments/job/${jobId}`).then((r) => r.data),

  /** Create/initiate a payment order (POST /api/v1/payments) */
  createPayment: (payload: {
    job_id: string;
    amount?: number | string | null;
    payment_method?: PaymentMethod;
    gateway_ref_id?: string | null;
  }) =>
    apiClient.post<PaymentRecord>("/payments", payload).then((r) => r.data),

  /** Confirm payment settled (POST /api/v1/payments/{paymentId}/confirm) */
  confirmPayment: (
    paymentId: string,
    payload: {
      gateway_ref_id?: string | null;
      payment_method?: PaymentMethod | null;
    }
  ) =>
    apiClient
      .post<PaymentRecord>(`/payments/${paymentId}/confirm`, payload)
      .then((r) => r.data),
};
