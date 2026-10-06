import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone, UserCheck, Shield, Clock, AlertTriangle, Navigation, CheckCircle2 } from 'lucide-react';
import { useJob, useCancelJob } from '../../features/jobs/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { JobTimeline } from '../../components/JobTimeline';
import { Button } from '../../components/ui/Button';
import { jobsService } from '../../services/jobs.service';
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

  const ratingsQuery = useQuery({
    queryKey: ['jobs', jobId, 'ratings'],
    queryFn: () => (jobId ? jobsService.getJobRatings(jobId) : Promise.reject('No jobId')),
    enabled: Boolean(jobId) && job?.status === 'completed',
    staleTime: 1000 * 60,
  });

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
        <div className="w-12 h-12 bg-slate-200 rounded-full mx-auto" />
        <div className="h-6 bg-slate-200 rounded w-48 mx-auto" />
        <div className="h-32 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">Job Not Found</h2>
        <p className="text-sm text-slate-500">We could not locate this roadside assistance job.</p>
        <Button onClick={() => navigate('/owner')}>Return to Home</Button>
      </div>
    );
  }

  const handleCancel = async () => {
    if (confirm('Are you sure you want to cancel this assistance request?')) {
      try {
        await cancelJobMutation.mutateAsync({ jobId: job.id, reason: 'Cancelled by owner' });
      } catch (err: unknown) {
        const errorObj = err as { code?: string; status?: number; message?: string };
        if (errorObj?.code === 'JOB_ALREADY_TERMINAL' || errorObj?.status === 409) {
          // Treated as success per FRONTEND-GUIDE §2.5 / ADR-016
          return;
        }
        alert(errorObj?.message || 'Failed to cancel assistance request.');
      }
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
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/owner')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </button>
        <StatusBadge status={job.status} />
      </div>

      {/* Main Status Card */}
      <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Request ID: {job.id.slice(0, 8)}...
            </span>
            <h1 className="text-2xl font-black text-slate-900 mt-0.5">
              {job.service?.name || 'Roadside Assistance'}
            </h1>
            <p className="text-xs font-mono px-2 py-0.5 mt-1 inline-block rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
              Vehicle: {job.vehicle_number}
            </p>
          </div>
        </div>

        {/* Dynamic Status Progress Description */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          {job.status === 'matching' && (
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500 animate-ping" />
              <p className="text-sm text-amber-900 font-medium">
                Searching and ranking verified partners in Bengaluru...
              </p>
            </div>
          )}

          {job.status === 'assigned' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-brand-800 font-semibold text-sm">
                <UserCheck className="w-4 h-4 text-brand-700" />
                <span>Partner Found! Preparing to dispatch.</span>
              </div>
              <p className="text-xs text-slate-500">The partner has accepted your service request.</p>
            </div>
          )}

          {job.status === 'partner_en_route' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sky-800 font-semibold text-sm">
                <Clock className="w-4 h-4 text-sky-700" />
                <span>
                  {etaMinutes !== null
                    ? `Partner En Route (Estimated Arrival Time: ~${etaMinutes} min)`
                    : 'Partner En Route (Estimated Arrival Time: calculating…)'}
                </span>
              </div>
              <p className="text-xs text-slate-500">Live coordinates are being tracked.</p>
            </div>
          )}

          {job.status === 'in_progress' && (
            <p className="text-sm text-brand-800 font-medium">
              Partner has arrived on site and work is currently in progress.
            </p>
          )}

          {job.status === 'completed' && (
            <p className="text-sm text-green-800 font-medium">
              Assistance completed successfully.
            </p>
          )}

          {job.status === 'no_match_found' && (
            <div className="flex items-start gap-2 text-amber-900 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Operations Support Alerted</span>
                <span className="text-xs text-amber-800">
                  Automated matching exhausted candidates. An operations specialist is manually coordinating assistance for you now.
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
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                  {partnerName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-bold text-slate-900">{partnerName}</h4>
                    <Shield className="w-3.5 h-3.5 text-brand-700" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>
                      ★ {partnerRating != null ? Number(partnerRating).toFixed(1) : 'New'} ({partnerRatingCount} jobs)
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-700 text-white rounded-lg text-sm font-semibold hover:bg-brand-800 touch-target"
                >
                  <Phone className="w-4 h-4" /> Call
                </a>
              )}
            </div>
          );
        })()}

        {/* Completed Job Rating Card */}
        {job.status === 'completed' && canRate && !alreadyRated && (
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">Rate your experience</h4>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`text-2xl transition-transform hover:scale-110 cursor-pointer ${
                    star <= rating ? 'text-amber-400' : 'text-slate-200'
                  }`}
                  aria-label={`${star} star`}
                >
                  ★
                </button>
              ))}
              {rating > 0 && (
                <span className="text-xs font-semibold text-slate-600 ml-2">
                  {rating} / 5
                </span>
              )}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Leave feedback for the partner (optional)"
              className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={2}
            />
            {ratingError && (
              <p className="text-xs text-red-600 font-medium">{ratingError}</p>
            )}
            <Button
              size="sm"
              disabled={rating === 0 || isSubmittingRating}
              isLoading={isSubmittingRating}
              onClick={handleSubmitRating}
            >
              Submit Rating
            </Button>
          </div>
        )}

        {job.status === 'completed' && (alreadyRated || isRated) && (
          <div className="pt-3 border-t border-slate-100 text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Thank you for rating this service!
          </div>
        )}

        {/* Cancellation Action (available across all active non-terminal statuses; no_match_found has dedicated prompt below) */}
        {job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'no_match_found' && (
          <div className="pt-2 border-t border-slate-100 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              isLoading={cancelJobMutation.isPending}
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              Cancel Request
            </Button>
          </div>
        )}

        {/* Action on no_match_found */}
        {job.status === 'no_match_found' && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              isLoading={cancelJobMutation.isPending}
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/owner')}
            >
              Request Again
            </Button>
          </div>
        )}
      </div>

      {/* Live Dispatch Progress Timeline */}
      <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Live Dispatch Progress
        </h3>
        <JobTimeline
          status={job.status}
          variant="full"
          timestamps={extractTimestamps(job)}
        />
      </div>
    </div>
  );
};
