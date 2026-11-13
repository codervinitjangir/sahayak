export type PaymentMethod = 'upi' | 'cash' | 'card' | 'netbanking';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  job_id: string;
  amount: number | string | null;
  status: PaymentStatus;
  payment_method?: PaymentMethod | null;
  gateway_ref_id?: string | null;
  upi_intent?: string | null;
  created_at: string;
}

export interface PaymentCreateRequest {
  job_id: string;
  amount?: number | string | null;
  payment_method?: PaymentMethod;
  gateway_ref_id?: string | null;
}

export interface PaymentConfirmRequest {
  gateway_ref_id?: string | null;
  payment_method?: PaymentMethod | null;
}
