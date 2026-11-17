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

/** GET /payments/{id}/receipt. A receipt, never a GST tax invoice (is_tax_invoice is false). */
export interface PaymentReceipt {
  receipt_number: string;
  payment_id: string;
  job_id: string;
  service_name?: string | null;
  vehicle_number?: string | null;
  partner_name?: string | null;
  pickup_address?: string | null;
  completed_at?: string | null;
  paid_at: string;
  amount: number | string;
  currency: "INR";
  payment_method?: string | null;
  payment_reference?: string | null;
  status: "paid" | "refunded";
  is_tax_invoice: boolean;
}

export const paymentsApi = {
  /** Receipt for a settled payment. 409 INVALID_PAYMENT_STATE while pending; 404 if not yours. */
  getReceipt: (paymentId: string) =>
    apiClient.get<PaymentReceipt>(`/payments/${paymentId}/receipt`).then((r) => r.data),

  /** Newest payment for a job (GET /api/v1/payments/job/{jobId}). 404 PAYMENT_NOT_FOUND until one is opened with createPayment. */
  getJobPayment: (jobId: string) =>
    apiClient.get<PaymentRecord>(`/payments/job/${jobId}`).then((r) => r.data),

  /** Create/initiate a payment order (POST /api/v1/payments) */
  createPayment: (payload: {
    job_id: string;
    payment_method?: PaymentMethod;
    gateway_ref_id?: string | null;
  }) =>
    apiClient.post<PaymentRecord>("/payments", payload).then((r) => r.data),

  /** Confirm payment received (POST /api/v1/payments/{paymentId}/confirm). Assigned partner or admin only; the owner gets 403. */
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

