import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Car, MapPin, Phone, Wrench } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { JobTimeline } from '../../components/JobTimeline';
import { NEXT_TRANSITION, useJobStatusTransition } from '../../features/partners/useOffers';
import { partnerService } from '../../services/partner.service';
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

  const handleAdvance = async () => {
    if (!job || !next) return;
    const updated = await transition.mutateAsync({ jobId: job.id, status: next.next });
    // A completed job is no longer "active" — the dashboard is where the next
    // one arrives, so send the partner straight back there.
    if (updated.status === 'completed') navigate('/partner/dashboard');
  };

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
              <CardHeader eyebrow="Active job" title={job.service?.name || 'Roadside assistance'} />

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

                {job.partner?.phone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact</dt>
                      <dd className="text-base text-slate-900">
                        <a href={`tel:${job.partner.phone}`} className="text-brand-700 font-semibold">
                          {job.partner.phone}
                        </a>
                      </dd>
                    </div>
                  </div>
                )}
              </dl>
            </Card>

            {transition.isError && (
              <p
                role="status"
                className="flex items-center gap-2 bg-amber-50 border border-status-warning/30 rounded-xl px-4 py-3 text-sm font-semibold text-status-warning"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                Could not update the job. Check your connection and try again.
              </p>
            )}

            {next ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={transition.isPending}
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
