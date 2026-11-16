import React from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  Phone,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Car,
  Wrench,
  RefreshCw,
  Navigation,
} from 'lucide-react';
import { jobsService } from '../../services/jobs.service';
import { StatusBadge } from '../../components/StatusBadge';
import { JobTimeline } from '../../components/JobTimeline';
import { JobStatus } from '../../types/jobs';

export const PublicTrackPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  // The owner's share token. Without it the server answers 404, the same as
  // for a job that does not exist.
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') ?? '';

  const {
    data: tracking,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['public-tracking', jobId, token],
    queryFn: () => jobsService.getPublicTracking(jobId as string, token),
    enabled: Boolean(jobId && token),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'cancelled' || status === 'no_match_found') {
        return false;
      }
      return 5000;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 flex items-center justify-center">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 border-4 border-brand-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <h2 className="text-lg font-bold text-ink">Connecting to live tracker…</h2>
          <p className="text-sm text-ink-soft">Loading rescue status & partner location</p>
        </div>
      </div>
    );
  }

  // A failed poll (429, a blip) keeps showing the last good data; only a first
  // load with nothing to show falls through to "not found".
  if (!tracking) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-line rounded-card p-6 text-center space-y-4 shadow-sm">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold text-ink">Assistance Request Not Found</h2>
          <p className="text-sm text-ink-soft">
            This tracking link may have expired, or the request code is incorrect.
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-control bg-brand-700 text-white font-semibold text-sm hover:bg-brand-800 transition-colors"
            >
              Go to Sahayak Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isLive = ['matching', 'assigned', 'partner_en_route', 'in_progress'].includes(tracking.status);

  return (
    <div className="min-h-screen bg-slate-50 text-ink pb-12">
      {/* Top Banner */}
      <header className="bg-white border-b border-line px-4 py-3 sticky top-0 z-20 shadow-xs">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-700 text-white flex items-center justify-center font-bold text-sm">
              S
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-ink block leading-none">
                Sahayak Live Safety
              </span>
              <span className="text-xs text-ink-muted">Trip & Rescue Tracker</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && (
              <RefreshCw className="w-3.5 h-3.5 text-brand-700 animate-spin" aria-hidden="true" />
            )}
            <StatusBadge status={tracking.status} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {/* Main Status Hero */}
        <div className="bg-white border border-line rounded-card p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Roadside Assistance
              </span>
              <h1 className="text-2xl font-bold text-ink mt-0.5">
                {tracking.service_name || 'Emergency Help'}
              </h1>
              {tracking.vehicle_number && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Car className="w-4 h-4 text-ink-soft" />
                  <span className="text-sm font-mono font-bold text-ink bg-slate-100 px-2 py-0.5 rounded border border-line">
                    {tracking.vehicle_number}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Status Message & ETA */}
          <div className="p-4 rounded-control bg-slate-50 border border-line space-y-2">
            {tracking.status === 'matching' && (
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </span>
                <p className="text-sm font-medium text-amber-900">
                  Assigning nearest verified emergency partner…
                </p>
              </div>
            )}

            {tracking.status === 'assigned' && (
              <p className="text-sm font-medium text-brand-800">
                Partner assigned and confirmed. Preparing to dispatch.
              </p>
            )}

            {tracking.status === 'partner_en_route' && (
              <div className="flex items-center gap-2 text-sky-800 font-semibold text-sm">
                <Clock className="w-4 h-4 text-sky-700" />
                <span>
                  {tracking.estimated_arrival_min != null
                    ? `Partner on the way · Estimated arrival in ~${tracking.estimated_arrival_min} min`
                    : 'Partner is on the way to the vehicle'}
                </span>
              </div>
            )}

            {tracking.status === 'in_progress' && (
              <div className="flex items-center gap-2 text-brand-800 font-semibold text-sm">
                <Wrench className="w-4 h-4 text-brand-700" />
                <span>Service is actively in progress at the vehicle.</span>
              </div>
            )}

            {tracking.status === 'completed' && (
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Service completed successfully. Vehicle is road-ready.</span>
              </div>
            )}

            {tracking.partner_lat != null && tracking.partner_lng != null && isLive && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200 text-slate-800 text-xs font-medium">
                <Navigation className="w-3.5 h-3.5 text-slate-600 animate-pulse" />
                <span>
                  Live GPS signal received
                  {tracking.partner_location_updated_at ? ` · Updated recently` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Assigned Partner Details */}
          {tracking.partner_name && (
            <div className="pt-4 border-t border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold text-base">
                  {tracking.partner_name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-bold text-ink">{tracking.partner_name}</h4>
                    <Shield className="w-3.5 h-3.5 text-brand-700" aria-label="Verified Sahayak partner" />
                  </div>
                  <p className="text-xs text-ink-soft">
                    {tracking.partner_rating != null
                      ? `★ ${tracking.partner_rating.toFixed(1)} rating · ${tracking.partner_rating_count} jobs`
                      : 'Verified Service Specialist'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pickup Location Info */}
          {tracking.pickup_address_text && (
            <div className="pt-4 border-t border-line flex items-start gap-2.5 text-sm text-ink-soft">
              <MapPin className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <span>Location: {tracking.pickup_address_text}</span>
            </div>
          )}
        </div>

        {/* Emergency Assistance Strip */}
        <div className="bg-white border border-line rounded-card p-5 space-y-3 shadow-xs">
          <h3 className="font-bold text-sm text-ink flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-700" />
            Emergency Contacts
          </h3>
          <p className="text-xs text-ink-soft">
            If you suspect danger or need dispatch assistance immediately:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <a
              href={`tel:${tracking.sos_number}`}
              className="flex items-center justify-center gap-2 min-h-[46px] rounded-control border border-emergency-600 bg-white text-emergency-700 font-bold text-sm hover:bg-emergency-50 transition-colors"
            >
              <Phone className="w-4 h-4" />
              Police / Emergency (112)
            </a>
            <a
              href={`tel:${tracking.emergency_helpline}`}
              className="flex items-center justify-center gap-2 min-h-[46px] rounded-control border border-line bg-slate-50 text-ink font-bold text-sm hover:bg-slate-100 transition-colors"
            >
              <Phone className="w-4 h-4 text-brand-700" />
              Sahayak Helpline
            </a>
          </div>
        </div>

        {/* Progress Timeline */}
        <div className="bg-white border border-line rounded-card p-5 sm:p-6 shadow-xs space-y-4">
          <h3 className="font-bold text-ink">Journey Timeline</h3>
          <JobTimeline
            status={tracking.status as JobStatus}
            variant="compact"
            timestamps={{
              requested: tracking.requested_at,
              completed: tracking.completed_at || undefined,
            }}
          />
        </div>

        {/* Footer */}
        <footer className="text-center pt-4 text-xs text-ink-muted">
          <p>Powered by Sahayak Roadside Safety Network</p>
          <p className="mt-1">
            Real-time coordinates and updates are encrypted and refreshed live.
          </p>
        </footer>
      </main>
    </div>
  );
};
