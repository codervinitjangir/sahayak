import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, UserCheck, Shield, Clock, AlertTriangle, Navigation } from 'lucide-react';
import { useJob, useCancelJob } from '../../features/jobs/hooks';
import { StatusBadge } from '../../components/StatusBadge';
import { JobTimeline } from '../../components/JobTimeline';
import { Button } from '../../components/ui/Button';
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
      await cancelJobMutation.mutateAsync({ jobId: job.id, reason: 'Cancelled by owner' });
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
        {job.partner && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                {job.partner.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-bold text-slate-900">{job.partner.name}</h4>
                  <Shield className="w-3.5 h-3.5 text-brand-700" />
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>★ {job.partner.rating_avg.toFixed(1)} ({job.partner.rating_count} jobs)</span>
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

            <a
              href={`tel:${job.partner.phone}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-700 text-white rounded-lg text-sm font-semibold hover:bg-brand-800 touch-target"
            >
              <Phone className="w-4 h-4" /> Call
            </a>
          </div>
        )}

        {/* Cancellation Action (only while matching or assigned) */}
        {(job.status === 'requested' || job.status === 'matching' || job.status === 'assigned') && (
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
