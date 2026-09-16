import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Camera, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useVehicles } from '../../features/vehicles/hooks';
import { useServices, useCreateJob } from '../../features/jobs/hooks';
import { LocationPicker } from '../../components/LocationPicker';
import { ServiceCard } from '../../components/ServiceCard';
import { VehicleSelector } from '../../components/VehicleSelector';
import { Button } from '../../components/ui/Button';
import { LocationPoint, Service } from '../../types/jobs';

// Default seeded services per Sahayak specifications if API reference list is loading/empty
const FALLBACK_SERVICES: Service[] = [
  { id: 1, category_id: 1, code: 'flat_tyre', name: 'Flat-Tyre Support', requires_vehicle_equipment: false, estimated_price: 350 },
  { id: 2, category_id: 1, code: 'battery_jumpstart', name: 'Battery Jumpstart', requires_vehicle_equipment: false, estimated_price: 450 },
  { id: 3, category_id: 2, code: 'minor_repair', name: 'On-Site Minor Repair', requires_vehicle_equipment: false, estimated_price: 500 },
  { id: 4, category_id: 3, code: 'flatbed_tow', name: 'Flatbed Towing', requires_vehicle_equipment: true, estimated_price: 1500 },
  { id: 5, category_id: 3, code: 'wheel_lift_tow', name: 'Wheel-Lift Towing', requires_vehicle_equipment: true, estimated_price: 1200 },
  { id: 6, category_id: 1, code: 'fuel_delivery', name: 'Emergency Fuel (5L)', requires_vehicle_equipment: false, estimated_price: 300 },
];

export const RequestHelpPage: React.FC = () => {
  const navigate = useNavigate();

  // Queries
  const { data: serverVehicles = [], isLoading: isLoadingVehicles } = useVehicles();
  const { data: serverServices = [], isLoading: isLoadingServices } = useServices();
  const createJobMutation = useCreateJob();

  // Active services list
  const services = serverServices.length > 0 ? serverServices : FALLBACK_SERVICES;

  // Fallback demo vehicles if none registered yet
  const vehicles =
    serverVehicles.length > 0
      ? serverVehicles
      : [
          {
            id: 'demo-veh-1',
            user_id: 'owner-1',
            vehicle_type: 'four_wheeler' as const,
            make: 'Hyundai',
            model: 'i20',
            vehicle_number: 'KA-01-MJ-4521',
            created_at: new Date().toISOString(),
          },
        ];

  // Emergency-first form state: Location is step 1
  const [pickupLocation, setPickupLocation] = useState<LocationPoint>({
    lat: 12.9716,
    lng: 77.5946,
    address: 'Bengaluru Central, Karnataka',
  });

  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(vehicles[0]?.id || '');
  const [issueDescription, setIssueDescription] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-select first vehicle when serverVehicles load or if unselected
  useEffect(() => {
    if (serverVehicles.length > 0) {
      if (!selectedVehicleId || selectedVehicleId.startsWith('demo-') || !serverVehicles.some((v) => v.id === selectedVehicleId)) {
        setSelectedVehicleId(serverVehicles[0].id);
      }
    } else if (!selectedVehicleId && vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [serverVehicles, vehicles, selectedVehicleId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!pickupLocation || !pickupLocation.lat || !pickupLocation.lng) {
      setFormError('Please pinpoint your emergency pickup location.');
      return;
    }

    if (!selectedServiceId) {
      setFormError('Please select the roadside assistance service needed.');
      return;
    }

    if (!selectedVehicleId) {
      setFormError('Please select which vehicle requires assistance.');
      return;
    }

    try {
      // Generate client-side Idempotency-Key (UUID v4) as required by API specification
      const idempotencyKey = crypto.randomUUID();

      const newJob = await createJobMutation.mutateAsync({
        payload: {
          vehicle_id: selectedVehicleId,
          service_id: selectedServiceId,
          pickup: pickupLocation,
          issue_description: issueDescription || undefined,
          issue_photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
        },
        idempotencyKey,
      });

      // Redirect to live matching / tracking page
      navigate(`/owner/jobs/${newJob.id}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to dispatch request. Please try again.';
      setFormError(errorMsg);
    }
  };

  const handleSimulatePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // In local/test mode, create an object URL representation
      const file = files[0];
      const simulatedUrl = URL.createObjectURL(file);
      setPhotoUrls((prev) => [...prev, simulatedUrl]);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
      {/* Header & Navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/owner')}
          className="p-2 -ml-2 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 touch-target focus:outline-none focus:ring-2 focus:ring-brand-700"
          aria-label="Go back to owner dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">Request Roadside Help</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Explainable weighted dispatch to verified Bengaluru partners
          </p>
        </div>
      </div>

      {formError && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-sm animate-shake"
        >
          <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Request Submission Failed</span>
            <span>{formError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1: Emergency Location (UX Guideline: Location First!) */}
        <section aria-labelledby="location-section-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="location-section-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-700 text-white text-xs font-bold inline-flex items-center justify-center">
                1
              </span>
              <span>Where is your vehicle stranded?</span>
            </h2>
            <span className="text-xs text-emergency-700 font-semibold uppercase tracking-wider">Required</span>
          </div>
          <p className="text-xs text-slate-500">
            Accurate coordinates allow the dispatch engine to compute precise driving distances.
          </p>
          <LocationPicker location={pickupLocation} onChange={(loc) => setPickupLocation(loc)} />
        </section>

        {/* Step 2: Service Selection */}
        <section aria-labelledby="service-section-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="service-section-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-700 text-white text-xs font-bold inline-flex items-center justify-center">
                2
              </span>
              <span>Select Service Needed</span>
            </h2>
            <span className="text-xs text-emergency-700 font-semibold uppercase tracking-wider">Required</span>
          </div>

          {isLoadingServices ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-slate-200 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Available services">
              {services.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isSelected={selectedServiceId === service.id}
                  onSelect={(s) => setSelectedServiceId(s.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Step 3: Vehicle Selection */}
        <section aria-labelledby="vehicle-section-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="vehicle-section-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-700 text-white text-xs font-bold inline-flex items-center justify-center">
                3
              </span>
              <span>Select Vehicle</span>
            </h2>
            <span className="text-xs text-emergency-700 font-semibold uppercase tracking-wider">Required</span>
          </div>
          <p className="text-xs text-slate-500">
            Vehicle registration and type are captured on the job record for partner equipment matching.
          </p>
          <VehicleSelector
            vehicles={vehicles}
            selectedVehicleId={selectedVehicleId}
            onSelectVehicle={(v) => setSelectedVehicleId(v.id)}
            isLoading={isLoadingVehicles}
          />
        </section>

        {/* Step 4: Issue Notes & Photos */}
        <section aria-labelledby="details-section-heading" className="space-y-3">
          <h2 id="details-section-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center justify-center">
              4
            </span>
            <span>Issue Details & Photos (Optional)</span>
          </h2>

          <div className="space-y-3">
            <div>
              <label htmlFor="issue-notes" className="block text-xs font-semibold text-slate-600 mb-1">
                Describe what happened
              </label>
              <textarea
                id="issue-notes"
                rows={3}
                placeholder="e.g. Left rear tyre is flat, I am parked on the roadside shoulder with hazards on."
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-lg text-base text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Attach breakdown photo (helps partner arrive prepared)
              </label>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-lg border border-slate-300 transition-colors touch-target">
                  <Camera className="w-4 h-4" />
                  <span>Take / Upload Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSimulatePhotoUpload}
                  />
                </label>

                {photoUrls.length > 0 && (
                  <span className="text-xs font-semibold text-brand-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-brand-700" />
                    <span>{photoUrls.length} photo attached</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Submit Button & Notice */}
        <div className="pt-4 space-y-3">
          <Button
            type="submit"
            size="lg"
            variant="primary"
            isLoading={createJobMutation.isPending}
            className="w-full text-lg font-bold shadow-md bg-brand-700 hover:bg-brand-800"
          >
            <ShieldAlert className="w-5 h-5 text-white" />
            <span>Dispatch Verified Partner</span>
          </Button>

          <p className="text-xs text-center text-slate-500">
            By dispatching, you consent to sharing your vehicle and breakdown coordinates with eligible verified service partners.
          </p>
        </div>
      </form>
    </div>
  );
};
