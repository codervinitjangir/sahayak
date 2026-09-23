import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, ChevronRight, Shield, Clock, MapPin } from 'lucide-react';
import { useVehicles } from '../../features/vehicles/hooks';
import { useJobs } from '../../features/jobs/hooks';
import { VehicleSelector } from '../../components/VehicleSelector';
import { AddVehicleModal } from '../../components/AddVehicleModal';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/Button';

export const OwnerHome: React.FC = () => {
  const navigate = useNavigate();
  const { data: vehicles = [], isLoading: isLoadingVehicles } = useVehicles();
  const { data: jobs = [], isLoading: isLoadingJobs } = useJobs();

  // Highlighting only — the vehicle for a job is chosen on the request form.
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | undefined>();
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const highlightedVehicleId = selectedVehicleId ?? vehicles[0]?.id;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-8">
      {/* Emergency Help CTA Banner */}
      <section
        aria-labelledby="emergency-heading"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-slate-900 text-white p-6 sm:p-8 shadow-md"
      >
        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-teal-100 text-xs font-semibold backdrop-blur-sm">
            <Shield className="w-3.5 h-3.5 text-teal-300" />
            <span>Bengaluru Emergency Dispatch</span>
          </div>

          <div>
            <h1 id="emergency-heading" className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Stranded on the road?
            </h1>
            <p className="mt-1 text-teal-100 text-base max-w-xl">
              Get immediate, accountable assistance from verified nearby mechanics and tow operators.
            </p>
          </div>

          <div className="pt-2">
            <Button
              size="lg"
              variant="primary"
              onClick={() => navigate('/owner/request')}
              className="bg-white text-brand-900 hover:bg-slate-100 active:bg-slate-200 font-bold shadow-lg text-lg w-full sm:w-auto"
            >
              <AlertOctagon className="w-6 h-6 text-emergency-700" />
              <span>Request Roadside Help Now</span>
            </Button>
          </div>
        </div>

        <div className="absolute right-0 bottom-0 opacity-10 translate-x-8 translate-y-8 pointer-events-none">
          <AlertOctagon className="w-64 h-64 text-white" />
        </div>
      </section>

      {/* Saved Vehicles Section */}
      <section aria-labelledby="vehicles-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="vehicles-heading" className="text-lg font-bold text-slate-900">
            My Saved Vehicles
          </h2>
          <span className="text-xs text-slate-500 font-medium">
            {vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'} registered
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

      {/* Recent Assistance Requests */}
      <section aria-labelledby="recent-jobs-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="recent-jobs-heading" className="text-lg font-bold text-slate-900">
            Recent Requests
          </h2>
          {jobs.length > 0 && (
            <span className="text-xs text-slate-500 font-medium">
              Showing {jobs.length} recent
            </span>
          )}
        </div>

        {isLoadingJobs ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-slate-200 rounded-xl" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center border border-slate-200 bg-white rounded-xl">
            <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No previous assistance requests</p>
            <p className="text-xs text-slate-500 mt-1">
              When you submit an emergency help request, it will appear here with live tracking.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => navigate(`/owner/jobs/${job.id}`)}
                className="p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-xl transition-all shadow-sm hover:shadow cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 touch-target"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={job.status} size="sm" />
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                      {job.vehicle_number}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900">
                    {job.service?.name || `Service #${job.service_id}`}
                  </h3>

                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate max-w-xs sm:max-w-md">
                      {job.pickup_address_text || (job.pickup_location ? `${job.pickup_location.lat}, ${job.pickup_location.lng}` : 'Bengaluru')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100">
                  <span className="text-xs text-slate-400">
                    {new Date(job.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="inline-flex items-center text-sm font-semibold text-brand-700">
                    <span>Track</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
