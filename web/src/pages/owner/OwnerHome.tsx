import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock, LifeBuoy, MapPin, Radio } from 'lucide-react';
import { useVehicles } from '../../features/vehicles/hooks';
import { useJobs } from '../../features/jobs/hooks';
import { VehicleSelector } from '../../components/VehicleSelector';
import { AddVehicleModal } from '../../components/AddVehicleModal';
import { StatusBadge } from '../../components/StatusBadge';
import { SafetyStrip } from '../../components/SafetyStrip';
import { Skeleton } from '../../components/ui/Skeleton';
import type { JobStatus } from '../../types/jobs';

const TERMINAL: JobStatus[] = ['completed', 'cancelled', 'no_match_found'];

export const OwnerHome: React.FC = () => {
  const { data: vehicles = [], isLoading: isLoadingVehicles } = useVehicles();
  const { data: jobs = [], isLoading: isLoadingJobs } = useJobs();

  // Highlighting only: the vehicle for a job is chosen on the request form.
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | undefined>();
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const highlightedVehicleId = selectedVehicleId ?? vehicles[0]?.id;

  const activeJob = jobs.find((j) => !TERMINAL.includes(j.status));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-8">
      {/* Primary action */}
      <section aria-labelledby="emergency-heading" className="rounded-sheet bg-brand-900 text-white p-6 sm:p-8">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-brand-100">
          <MapPin className="w-4 h-4" aria-hidden="true" />
          Roadside assistance in Bengaluru
        </p>
        <h1 id="emergency-heading" className="mt-3 text-3xl font-bold tracking-tight">
          Stranded on the road?
        </h1>
        <p className="mt-2 text-brand-100 max-w-xl leading-relaxed">
          Tell us where you are and what happened. We will match you with a verified partner nearby.
        </p>
        <Link
          to="/owner/request"
          className="mt-6 inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-[56px] px-8 rounded-control bg-white text-brand-900 text-lg font-semibold hover:bg-brand-50 transition-colors"
        >
          <LifeBuoy className="w-6 h-6" aria-hidden="true" />
          Request help
        </Link>
      </section>

      <SafetyStrip />

      {/* A request already in flight comes first */}
      {activeJob && (
        <Link
          to={`/owner/jobs/${activeJob.id}`}
          className="flex items-center gap-4 rounded-card border-2 border-brand-700 bg-brand-50 p-4 hover:bg-brand-100 transition-colors"
        >
          <span className="w-11 h-11 rounded-full bg-brand-700 text-white flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-brand-800">Your request is in progress</span>
            <span className="block font-bold truncate">{activeJob.service_name || activeJob.service_code}</span>
          </span>
          <StatusBadge status={activeJob.status} size="sm" />
          <ChevronRight className="w-5 h-5 text-brand-800 shrink-0" aria-hidden="true" />
        </Link>
      )}

      {/* Vehicles */}
      <section aria-labelledby="vehicles-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="vehicles-heading" className="text-lg font-bold">
            My vehicles
          </h2>
          <span className="text-sm text-ink-muted tnum">
            {vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'}
          </span>
        </div>

        <VehicleSelector
          vehicles={vehicles}
          selectedVehicleId={highlightedVehicleId}
          onSelectVehicle={(v) => setSelectedVehicleId(v.id)}
          onAddNewVehicle={() => setIsAddVehicleOpen(true)}
          isLoading={isLoadingVehicles}
        />

        <AddVehicleModal
          isOpen={isAddVehicleOpen}
          onClose={() => setIsAddVehicleOpen(false)}
          onSuccess={(veh) => setSelectedVehicleId(veh.id)}
        />
      </section>

      {/* History */}
      <section aria-labelledby="recent-jobs-heading" className="space-y-3">
        <h2 id="recent-jobs-heading" className="text-lg font-bold">
          Recent requests
        </h2>

        {isLoadingJobs ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} variant="rectangular" height={88} className="w-full" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center border border-line bg-white rounded-card">
            <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
            <p className="font-semibold">No requests yet</p>
            <p className="text-sm text-ink-soft mt-1">
              When you ask for help, it will show up here and you can follow it live.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  to={`/owner/jobs/${job.id}`}
                  className="flex items-center gap-4 p-4 bg-white border border-line hover:border-slate-300 rounded-card transition-colors min-h-[72px]"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={job.status} size="sm" />
                      {job.vehicle_number && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-100 text-ink-soft font-semibold border border-line">
                          {job.vehicle_number}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold truncate">{job.service_name || job.service_code}</h3>
                    <p className="flex items-center gap-1 text-sm text-ink-muted">
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{job.pickup_address_text || 'Pickup location'}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-ink-muted tnum">
                      {new Date(job.requested_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                      {' · '}
                      {new Date(job.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <span className="inline-flex items-center text-sm font-semibold text-brand-700 mt-1">
                      {TERMINAL.includes(job.status) ? 'Details' : 'Track'}
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
