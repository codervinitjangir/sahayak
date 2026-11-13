import { ApiError, apiClient } from './api';
import {
  Payment,
  PaymentCreateRequest,
  PaymentConfirmRequest,
} from '../types/payments';

export const paymentsService = {
  /**
   * Newest payment for a job. 404 PAYMENT_NOT_FOUND when none has been opened.
   */
  async getJobPayment(jobId: string): Promise<Payment> {
    const res = await apiClient<Payment>(`/payments/job/${jobId}`, {
      method: 'GET',
    });
    return res.data;
  },

  /**
   * The job's payment, opening one if none exists yet. GET is read-only and
   * answers 404 PAYMENT_NOT_FOUND until a payment is opened; the amount is
   * always the job's own price, set by the server.
   */
  async getOrOpenJobPayment(jobId: string): Promise<Payment> {
    try {
      return await this.getJobPayment(jobId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_NOT_FOUND') {
        return this.createPayment({ job_id: jobId, payment_method: 'upi' });
      }
      throw err;
    }
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
   * Confirm the money was received. Assigned partner or admin only; the owner gets 403.
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

