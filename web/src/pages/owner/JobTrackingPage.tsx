import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Phone,
  UserCheck,
  Shield,
  Clock,
  AlertTriangle,
  Navigation,
  CheckCircle2,
  Share2,
  CreditCard,
  QrCode,
  Check,
} from 'lucide-react';
import { useJob, useCancelJob } from '../../features/jobs/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { JobTimeline } from '../../components/JobTimeline';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { StarRating } from '../../components/ui/StarRating';
import { SafetyStrip } from '../../components/SafetyStrip';
import { jobsService } from '../../services/jobs.service';
import { paymentsService } from '../../services/payments.service';
import { Job, JobStatus, JobTimelineEvent } from '../../types/jobs';

function extractTimestamps(job: Job): Partial<Record<JobStatus, string | undefined>> {
  const result: Partial<Record<JobStatus, string | undefined>> = {
    requested: job.requested_at,
    assigned: job.current_assignment?.accepted_at || job.current_assignment?.offered_at,
    completed: job.completed_at,
    cancelled: job.cancelled_at,
  };

  if (Array.isArray(job.timeline)) {
    (job.timeline as JobTimelineEvent[]).forEach((ev) => {
      if (ev.status && (ev.timestamp || ev.created_at)) {
        result[ev.status] = ev.timestamp || ev.created_at;
      }
    });
  } else if (job.timeline && typeof job.timeline === 'object') {
    Object.entries(job.timeline).forEach(([statusKey, timestamp]) => {
      if (typeof timestamp === 'string') {
        result[statusKey as JobStatus] = timestamp;
      }
    });
  }

  return result;
}

export const JobTrackingPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useJob(jobId);
  const cancelJobMutation = useCancelJob();

  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [isSubmittingRating, setIsSubmittingRating] = useState<boolean>(false);
  const [isRated, setIsRated] = useState<boolean>(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const ratingsQuery = useQuery({
    queryKey: ['jobs', jobId, 'ratings'],
    queryFn: () => (jobId ? jobsService.getJobRatings(jobId) : Promise.reject('No jobId')),
    enabled: Boolean(jobId) && job?.status === 'completed',
    staleTime: 1000 * 60,
  });

  const partnerLocationQuery = useQuery({
    queryKey: ['jobs', jobId, 'partner-location'],
    queryFn: () => (jobId ? jobsService.getPartnerLocation(jobId) : Promise.reject('No jobId')),
    enabled: Boolean(jobId) && ['assigned', 'partner_en_route', 'in_progress'].includes(job?.status || ''),
    refetchInterval: 5000,
  });

  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);

  const paymentQuery = useQuery({
    queryKey: ['jobs', jobId, 'payment'],
    queryFn: () => (jobId ? paymentsService.getOrOpenJobPayment(jobId) : Promise.reject('No jobId')),
    enabled: Boolean(jobId) && job?.status === 'completed',
    refetchInterval: (query) => (query.state.data?.status === 'paid' ? false : 3000),
  });

  const handleShareLiveStatus = async () => {
    if (!job?.share_token) return;
    const shareUrl = `${window.location.origin}/track/${job.id}?t=${encodeURIComponent(job.share_token)}`;
    const text = `Track my roadside assistance live on Sahayak: ${shareUrl}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'My Rescue Status', text, url: shareUrl });
      } catch {
        // Dismissal is fine
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    }
  };

  const canRate = ratingsQuery.data ? ratingsQuery.data.can_rate : !isRated;
  const alreadyRated = isRated || (ratingsQuery.data ? !ratingsQuery.data.can_rate : false);

  const handleSubmitRating = async () => {
    if (!job || rating === 0) return;
    setIsSubmittingRating(true);
    setRatingError(null);
    try {
      await jobsService.submitRating(job.id, rating, comment.trim() || undefined);
      setIsRated(true);
      ratingsQuery.refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit rating.';
      setRatingError(msg);
    } finally {
      setIsSubmittingRating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4 animate-pulse">
        <div className="w-12 h-12 bg-slate-200 rounded-full mx-auto" aria-hidden="true" />
        <div className="h-6 bg-slate-200 rounded w-48 mx-auto" />
        <div className="h-32 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold text-ink">Request not found</h2>
        <p className="text-ink-soft">We could not find this request. It may have been removed, or the link is wrong.</p>
        <Button onClick={() => navigate('/owner')}>Back to home</Button>
      </div>
    );
  }

  const handleCancel = () => {
    setCancelError(null);
    setConfirmCancelOpen(true);
  };

  const confirmCancel = async () => {
    setConfirmCancelOpen(false);
    try {
      await cancelJobMutation.mutateAsync({ jobId: job.id, reason: 'Cancelled by owner' });
    } catch (err: unknown) {
      const errorObj = err as { code?: string; status?: number; message?: string };
      if (errorObj?.code === 'JOB_ALREADY_TERMINAL' || errorObj?.status === 409) {
        // Treated as success per FRONTEND-GUIDE §2.5 / ADR-016
        return;
      }
      setCancelError(errorObj?.message || 'Could not cancel this request. Try again.');
    }
  };

  // Reported by the dispatch engine on the current assignment; absent until a
  // partner has been matched. Checked by type so an ETA of 0 still renders.
  const etaMinutes =
    typeof job.current_assignment?.estimated_arrival_min === 'number'
      ? job.current_assignment.estimated_arrival_min
      : null;

  const distanceKm =
    typeof job.current_assignment?.distance_at_offer_m === 'number'
      ? (job.current_assignment.distance_at_offer_m / 1000).toFixed(1)
      : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/owner')}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-ink-soft hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
        </button>
        <StatusBadge status={job.status} />
      </div>

      {/* Main Status Card */}
      <div className="p-5 sm:p-6 bg-white border border-line rounded-card space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
              Request {job.id.slice(0, 8)}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-ink mt-0.5">
              {job.service?.name || 'Roadside Assistance'}
            </h1>
            <p className="text-sm font-mono px-2 py-0.5 mt-1 inline-block rounded bg-slate-100 text-ink-soft font-semibold border border-line">
              Vehicle: {job.vehicle_number}
            </p>
          </div>
          <button
            type="button"
            onClick={handleShareLiveStatus}
            disabled={!job.share_token}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-ink transition-colors"
            title="Share live tracking link with family or friends"
          >
            {shareCopied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Link copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-brand-700" />
                <span>Share Live</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic Status Progress Description */}
        <div className="p-4 rounded-control bg-slate-50 border border-line space-y-2">
          {job.status === 'matching' && (
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500 animate-ping" />
              <p className="text-sm text-amber-900 font-medium">
                Looking for the best verified partner near you. You can leave this page; we will keep searching.
              </p>
            </div>
          )}

          {job.status === 'assigned' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-brand-800 font-semibold text-sm">
                <UserCheck className="w-4 h-4 text-brand-700" />
                <span>A partner has accepted your request.</span>
              </div>
              <p className="text-sm text-ink-soft">The partner has accepted your request.</p>
            </div>
          )}

          {job.status === 'partner_en_route' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sky-800 font-semibold text-sm">
                <Clock className="w-4 h-4 text-sky-700" />
                <span>
                  {etaMinutes !== null
                    ? `Partner is on the way · about ${etaMinutes} min`
                    : 'Partner is on the way'}
                </span>
              </div>
              <p className="text-sm text-ink-soft">Your partner is on the way to your pickup point.</p>
            </div>
          )}

          {partnerLocationQuery.data?.latitude && partnerLocationQuery.data?.longitude && (
            <div className="flex items-center gap-2.5 p-3 rounded-control bg-teal-50 border border-teal-200 text-teal-900 text-sm">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0F766E]"></span>
              </span>
              <span className="font-medium">
                Live location active · Partner moving towards pickup
              </span>
            </div>
          )}

          {(job.status === 'assigned' || job.status === 'partner_en_route') && job.start_code && (
            <div className="rounded-control border-2 border-brand-700 bg-white px-4 py-3" aria-label="Start code">
              <span className="block text-xs font-bold uppercase tracking-wide text-ink-muted">Your start code</span>
              <span className="block text-3xl font-bold tracking-[0.4em] text-ink tnum">{job.start_code}</span>
              <span className="block text-sm text-ink-soft mt-1">
                Read this to your partner only once they have reached your vehicle. Work cannot start without it.
              </span>
            </div>
          )}

          {job.price_estimate != null && job.status !== 'cancelled' && job.status !== 'no_match_found' && (
            <p className="text-sm text-slate-700">
              {job.status === 'completed' && job.price_final != null
                ? <>Final amount: <strong>₹{Number(job.price_final)}</strong></>
                : <>Upfront estimate: <strong>₹{Number(job.price_estimate)}</strong> — the partner confirms the final amount on completion.</>}
            </p>
          )}

          {job.status === 'in_progress' && (
            <p className="text-sm text-brand-800 font-medium">
              Your partner has started the work.
            </p>
          )}

          {job.status === 'completed' && (
            <p className="text-sm text-green-800 font-medium">
              Your request is complete.
            </p>
          )}

          {job.status === 'no_match_found' && (
            <div className="flex items-start gap-2 text-amber-900 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">No partner available right now</span>
                <span className="text-sm text-amber-800">
                  Every nearby verified partner was offered this job and none could take it. You can try again or cancel this request.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Assigned Partner Information */}
        {(() => {
          const partnerName = job.current_assignment?.partner_name || job.partner?.name;
          const partnerPhone = job.current_assignment?.partner_phone || job.partner?.phone;
          const partnerRating = job.current_assignment?.partner_rating ?? job.partner?.rating_avg;
          const partnerRatingCount = job.current_assignment?.partner_rating_count ?? job.partner?.rating_count ?? 0;
          if (!partnerName) return null;

          return (
            <div className="pt-4 border-t border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                  {partnerName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-bold text-ink">{partnerName}</h4>
                    <Shield className="w-3.5 h-3.5 text-brand-700" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-ink-soft">
                    <span>
                      {partnerRating != null ? `${Number(partnerRating).toFixed(1)} rating` : 'New partner'} · {partnerRatingCount} {partnerRatingCount === 1 ? 'job' : 'jobs'}
                    </span>
                    {distanceKm && (
                      <>
                        <span>•</span>
                        <span className="inline-flex items-center gap-0.5 text-slate-600 font-medium">
                          <Navigation className="w-3 h-3 text-brand-700" />
                          {distanceKm} km away
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {partnerPhone && (
                <a
                  href={`tel:${partnerPhone}`}
                  className="inline-flex items-center gap-1.5 px-4 min-h-[48px] bg-brand-700 text-white rounded-control text-sm font-semibold hover:bg-brand-800"
                >
                  <Phone className="w-4 h-4" /> Call
                </a>
              )}
            </div>
          );
        })()}

        {/* Completed Job Payment Card */}
        {job.status === 'completed' && paymentQuery.data && (
          <div className="pt-4 border-t border-line space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-ink flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-brand-700" />
                Service Settlement & Payment
              </h4>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-slate-100 text-ink">
                ₹{Number(paymentQuery.data.amount || job.price_final || 0)}
              </span>
            </div>

            {paymentQuery.data.status === 'paid' ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-control flex items-center gap-2 text-emerald-900 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Bill settled (₹{Number(paymentQuery.data.amount || job.price_final || 0)} via {paymentQuery.data.payment_method?.toUpperCase() || 'UPI'}). Confirmed by your mechanic.
                </span>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 border border-line rounded-control space-y-3">
                <p className="text-xs text-ink-soft">
                  The partner has completed the work. Please settle the final amount:
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {paymentQuery.data.upi_intent && (
                    <a
                      href={paymentQuery.data.upi_intent}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-brand-700 text-white font-semibold text-sm hover:bg-brand-800 transition-colors"
                    >
                      <CreditCard className="w-4 h-4" />
                      Pay ₹{Number(paymentQuery.data.amount || job.price_final || 0)} via UPI
                    </a>
                  )}
                  {paymentQuery.data.upi_intent && (
                    <button
                      type="button"
                      onClick={() => setShowQrModal(!showQrModal)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control border border-line bg-white hover:bg-slate-100 font-semibold text-sm text-ink transition-colors"
                    >
                      <QrCode className="w-4 h-4 text-brand-700" />
                      Show UPI QR
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-muted">
                  Paying cash? Hand it to your mechanic. This bill is marked settled once they confirm they received it.
                </p>

                {showQrModal && paymentQuery.data.upi_intent && (
                  <div className="p-4 bg-white border border-line rounded-control text-center space-y-2 mt-2">
                    <p className="text-xs font-bold text-ink">Scan with any UPI App (GPay / PhonePe / Paytm)</p>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(paymentQuery.data.upi_intent)}`}
                      alt="UPI Payment QR"
                      className="w-44 h-44 mx-auto border border-line p-2 rounded"
                    />
                    <p className="text-xs text-ink-muted font-mono">sahayak.dispatch@upi</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Completed Job Rating Card */}
        {job.status === 'completed' && canRate && !alreadyRated && (
          <div className="pt-4 border-t border-line space-y-3">
            <h4 className="font-bold text-ink">How was the service?</h4>
            <StarRating value={rating} onChange={setRating} size="lg" showScore />
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Leave feedback for the partner (optional)"
              className="w-full text-base p-3 rounded-control border border-line focus:outline-none focus:ring-2 focus:ring-brand-700"
              rows={2}
            />
            {ratingError && (
              <p className="text-sm text-emergency-700 font-medium" role="alert">{ratingError}</p>
            )}
            <Button
              disabled={rating === 0 || isSubmittingRating}
              isLoading={isSubmittingRating}
              onClick={handleSubmitRating}
            >
              Submit rating
            </Button>
          </div>
        )}

        {job.status === 'completed' && (alreadyRated || isRated) && (
          <div className="pt-4 border-t border-line text-sm font-semibold text-status-success flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            Thanks for rating this service.
          </div>
        )}

        {/* Cancellation Action (available across all active non-terminal statuses; no_match_found has dedicated prompt below) */}
        {job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'no_match_found' && (
          <div className="pt-4 border-t border-line flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              isLoading={cancelJobMutation.isPending}
              className="!border-emergency-600 !text-emergency-700 hover:!bg-emergency-50"
            >
              Cancel request
            </Button>
          </div>
        )}

        {/* Action on no_match_found */}
        {job.status === 'no_match_found' && (
          <div className="pt-4 border-t border-line flex items-center justify-end gap-2.5">
            <Button
              variant="outline"
              onClick={handleCancel}
              isLoading={cancelJobMutation.isPending}
            >
              Cancel request
            </Button>
            <Button variant="primary" onClick={() => navigate('/owner/request')}>
              Request again
            </Button>
          </div>
        )}
      </div>

      {cancelError && (
        <p className="text-sm text-emergency-700 font-medium" role="alert">
          {cancelError}
        </p>
      )}

      {job.status !== 'completed' && job.status !== 'cancelled' && (
        <section aria-label="Safety" className="space-y-1">
          <h3 className="text-sm font-semibold text-ink-soft">While you wait</h3>
          <SafetyStrip />
        </section>
      )}

      <ConfirmDialog
        isOpen={confirmCancelOpen}
        title="Cancel this request?"
        description="Your partner will be told and the request will be closed. You can start a new one at any time."
        confirmLabel="Yes, cancel"
        cancelLabel="Keep request"
        onConfirm={confirmCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      {/* Progress timeline */}
      <div className="p-5 sm:p-6 bg-white border border-line rounded-card space-y-4">
        <h3 className="font-bold text-ink">Progress</h3>
        <JobTimeline
          status={job.status}
          variant="full"
          timestamps={extractTimestamps(job)}
        />
      </div>
    </div>
  );
};
