import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ApiError } from '../../../services/api';
import { paymentsService } from '../../../services/payments.service';

/**
 * Settlement for a completed job, on the receiving side.
 *
 * The owner can open the UPI intent, but only the assigned partner (or an
 * admin) can say the money arrived: a payer attesting to their own payment
 * proves nothing.
 */
export const PaymentReceivedCard: React.FC<{ jobId: string }> = ({ jobId }) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<'upi' | 'cash' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paymentQuery = useQuery({
    queryKey: ['jobs', jobId, 'payment'],
    queryFn: async () => {
      try {
        return await paymentsService.getJobPayment(jobId);
      } catch (err) {
        // 404 until someone opens a payment; confirming will open one.
        if (err instanceof ApiError && err.code === 'PAYMENT_NOT_FOUND') return null;
        throw err;
      }
    },
  });
  const payment = paymentQuery.data ?? null;

  const confirm = async (method: 'upi' | 'cash') => {
    setConfirming(method);
    setError(null);
    try {
      const current = payment ?? (await paymentsService.createPayment({ job_id: jobId, payment_method: method }));
      const paid = await paymentsService.confirmPayment(current.id, { payment_method: method });
      queryClient.setQueryData(['jobs', jobId, 'payment'], paid);
    } catch {
      setError('Could not record the payment. Check your connection and try again.');
    } finally {
      setConfirming(null);
    }
  };

  return (
    <Card aria-label="Payment">
      <CardHeader title="Payment" className="mb-3" />
      {payment?.status === 'paid' ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Received ₹{Number(payment.amount ?? 0)}
          {payment.payment_method ? ` by ${payment.payment_method.toUpperCase()}` : ''}.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {payment?.amount != null ? `₹${Number(payment.amount)} due. ` : ''}
            Mark it settled once the money is in your hands or your UPI account.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" isLoading={confirming === 'cash'} disabled={confirming !== null} onClick={() => void confirm('cash')}>
              Cash received
            </Button>
            <Button size="sm" variant="outline" isLoading={confirming === 'upi'} disabled={confirming !== null} onClick={() => void confirm('upi')}>
              UPI payment received
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      )}
    </Card>
  );
};
