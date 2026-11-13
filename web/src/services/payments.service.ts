import { apiClient } from './api';
import {
  Payment,
  PaymentCreateRequest,
  PaymentConfirmRequest,
} from '../types/payments';

export const paymentsService = {
  /**
   * Get the current payment status for a job (or auto-initializes a pending order).
   */
  async getJobPayment(jobId: string): Promise<Payment> {
    const res = await apiClient<Payment>(`/payments/job/${jobId}`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * Explicitly create or initiate a payment order (e.g. UPI intent or Cash).
   */
  async createPayment(payload: PaymentCreateRequest): Promise<Payment> {
    const res = await apiClient<Payment>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  /**
   * Confirm that a payment order has been settled.
   */
  async confirmPayment(
    paymentId: string,
    payload: PaymentConfirmRequest
  ): Promise<Payment> {
    const res = await apiClient<Payment>(`/payments/${paymentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },
};
