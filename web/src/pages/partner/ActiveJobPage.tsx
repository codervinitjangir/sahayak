import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Car, MapPin, Phone, Wrench } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { JobTimeline } from '../../components/JobTimeline';
import { NEXT_TRANSITION, useJobStatusTransition } from '../../features/partners/useOffers';
import { partnerService } from '../../services/partner.service';
import { ApiError } from '../../services/api';
import { PaymentReceivedCard } from './components/PaymentReceivedCard';
import './partner.css';

/**
 * The job the partner is currently running.
 *
 * Exactly one primary button is shown, and it performs exactly the one
 * transition the current status allows — see NEXT_TRANSITION. There is no
 * free-form status picker, so a partner cannot skip "en route" or re-complete
 * a finished job.
 */
export const ActiveJobPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const jobQuery = useQuery({
    queryKey: ['partner', 'job', jobId],
    queryFn: () => partnerService.getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== 'completed' && status !== 'cancelled' ? 7000 : false;
    },
  });

  const transition = useJobStatusTransition();
  const job = jobQuery.data;
  const next = job ? NEXT_TRANSITION[job.status] : undefined;

  // The owner reads the 4-digit code out on arrival; the backend checks it.
  const [startCode, setStartCode] = useState('');
  // Final amount charged. Prefilled from the backend's upfront estimate.
  const [priceFinal, setPriceFinal] = useState('');
  useEffect(() => {
    if (job?.status === 'in_progress' && priceFinal === '' && job.price_estimate != null) {
      setPriceFinal(String(Number(job.price_estimate)));
    }
  }, [job?.status, job?.price_estimate, priceFinal]);

  const priceValue = Number(priceFinal);
  const needsCode = job?.status === 'partner_en_route';
  const needsPrice = job?.status === 'in_progress';
  // Mirrors the backend's ceiling (job_service._check_final_price_in_range):
  // max(5 x estimate, 5000), capped at 50000. Caught here so a mistyped amount
  // gets a plain message before the round trip.
  const priceCeiling =
    job?.price_estimate != null
      ? Math.min(50000, Math.max(Number(job.price_estimate) * 5, 5000))
      : 50000;
  const priceTooHigh = needsPrice && Number.isFinite(priceValue) && priceValue > priceCeiling;
  const inputInvalid =
    (needsCode && !/^\d{4}$/.test(startCode)) ||
    (needsPrice &&
      (priceFinal.trim() === '' || !Number.isFinite(priceValue) || priceValue < 0 || priceTooHigh));

  const handleAdvance = async () => {
    if (!job || !next || inputInvalid) return;
    try {
      await transition.mutateAsync({
        jobId: job.id,
        status: next.next,
        startCode: needsCode ? startCode : undefined,
        priceFinal: needsPrice ? priceValue : undefined,
      });
      setStartCode('');
      void jobQuery.refetch();
      // A completed job stays on screen so the partner can mark the payment
      // received; the dashboard is one tap away.
    } catch {
      // Rendered from transition.error below.
    }
  };

  const transitionError = transition.error
    ? transition.error instanceof ApiError
      ? transition.error.code === 'INVALID_START_CODE'
        ? 'That code does not match. Ask the owner to read the 4-digit code on their screen again.'
        : transition.error.code === 'PRICE_FINAL_OUT_OF_RANGE'
          ? 'That amount is far above the quote. Check it and enter the amount you actually charged.'
          : transition.error.message
      : 'Could not update the job. Check your connection and try again.'
    : null;

  return (
    <div className="min-h-full bg-bg overflow-y-auto">
      <div className="mx-auto w-full max-w-xl lg:max-w-5xl px-4 py-4 pb-8">
        <Link
          to="/partner/dashboard"
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-slate-500 hover:text-slate-800 focus:ring-2 focus:ring-teal-600 focus:outline-none rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Dashboard
        </Link>

        {jobQuery.isLoading && (
          <Card aria-label="Loading job" className="mt-3">
            <p className="text-sm text-slate-500">Loading job…</p>
          </Card>
        )}

        {!jobQuery.isLoading && !job && (
          <Card aria-label="Job not found" className="mt-3">
            <p className="text-base font-bold text-slate-900">That job is not on your board</p>
            <p className="mt-1 text-sm text-slate-500">
              It may have been reassigned, or it was never yours. Your dashboard shows what is live now.
            </p>
            <Button variant="outline" size="md" className="mt-3 w-full" onClick={() => navigate('/partner/dashboard')}>
              Back to dashboard
            </Button>
          </Card>
        )}

        {job && (
          // Phone: details, then the action, then progress. Desktop: details and
          // the action hold the wide column, progress becomes the right rail.
          <div className="mt-3 grid gap-3 lg:mt-4 lg:gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="grid gap-3 lg:gap-4 lg:content-start">
              <Card aria-label="Job details">
              <CardHeader eyebrow="Active job" title={job.service?.name || job.service_name || 'Roadside assistance'} />

              <dl className="mt-3 space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Pickup</dt>
                    <dd className="text-base text-slate-900">
                      {job.pickup_address_text || job.pickup_location?.address || 'Location shared by the owner'}
                    </dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Car className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Vehicle</dt>
                    <dd className="text-base text-slate-900">{job.vehicle_number}</dd>
                  </div>
                </div>

                {job.issue_description && (
                  <div className="flex items-start gap-3">
                    <Wrench className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Reported issue</dt>
                      <dd className="text-base text-slate-900">{job.issue_description}</dd>
                    </div>
                  </div>
                )}

                {(job.owner_name || job.owner_phone) && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Owner</dt>
                      <dd className="text-base text-slate-900">
                        {job.owner_name && <span className="block">{job.owner_name}</span>}
                        {job.owner_phone && (
                          <a href={`tel:${job.owner_phone}`} className="text-brand-700 font-semibold">
                            {job.owner_phone}
                          </a>
                        )}
                      </dd>
                    </div>
                  </div>
                )}
              </dl>
            </Card>

            {transitionError && (
              <p
                role="alert"
                className="flex items-center gap-2 bg-amber-50 border border-status-warning/30 rounded-xl px-4 py-3 text-sm font-semibold text-status-warning"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {transitionError}
              </p>
            )}

            {needsCode && (
              <Card aria-label="Start code">
                <label htmlFor="start-code" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Owner's 4-digit start code
                </label>
                <input
                  id="start-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  value={startCode}
                  onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="mt-2 w-full min-h-[48px] rounded-xl border border-slate-300 px-4 text-2xl tracking-[0.5em] font-bold text-slate-900 focus:ring-2 focus:ring-teal-600 focus:outline-none"
                  placeholder="••••"
                />
                <p className="mt-2 text-sm text-slate-500">Ask the owner for the code shown on their tracking screen. Work starts only after it matches.</p>
              </Card>
            )}

            {needsPrice && (
              <Card aria-label="Final price">
                <label htmlFor="price-final" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Final amount charged (₹)
                </label>
                <input
                  id="price-final"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="1"
                  value={priceFinal}
                  onChange={(e) => setPriceFinal(e.target.value)}
                  // Prefilled with the estimate; selecting on focus means typing
                  // replaces it instead of appending (499 -> 499499).
                  onFocus={(e) => e.target.select()}
                  aria-invalid={priceTooHigh}
                  className="mt-2 w-full min-h-[48px] rounded-xl border border-slate-300 px-4 text-lg font-bold text-slate-900 focus:ring-2 focus:ring-teal-600 focus:outline-none"
                />
                {priceTooHigh && (
                  <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
                    ₹{priceValue} is above the maximum of ₹{priceCeiling} for this job. Check for an extra digit.
                  </p>
                )}
                {job.price_estimate != null && (
                  <p className="mt-2 text-sm text-slate-500">Upfront estimate given to the owner: ₹{Number(job.price_estimate)}</p>
                )}
              </Card>
            )}

            {next ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={transition.isPending || inputInvalid}
                onClick={handleAdvance}
              >
                {next.label}
              </Button>
            ) : (
              <p className="text-center text-sm text-slate-500">
                No further action — this job is {job.status === 'completed' ? 'complete' : job.status.replace(/_/g, ' ')}.
              </p>
            )}
            </div>

            {job.status === 'completed' && <PaymentReceivedCard jobId={job.id} />}

            <Card aria-label="Progress">
              <CardHeader title="Progress" className="mb-3" />
              <JobTimeline
                status={job.status}
                variant="full"
                timestamps={{
                  requested: job.requested_at,
                  assigned: job.current_assignment?.accepted_at,
                  completed: job.completed_at,
                }}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
