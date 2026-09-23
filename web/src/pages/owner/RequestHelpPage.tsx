import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Camera, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useVehicles } from '../../features/vehicles/hooks';
import { useServices, useCreateJob } from '../../features/jobs/hooks';
import { createIdempotencyKey } from '../../services/api';
import { IS_DEMO_MODE } from '../../app/config';
import { LocationPicker } from '../../components/LocationPicker';
import { ServiceCard } from '../../components/ServiceCard';
import { VehicleSelector } from '../../components/VehicleSelector';
import { Button } from '../../components/ui/Button';
import { AddVehicleModal } from '../../components/AddVehicleModal';
import { getAuthToken, setAuthToken } from '../../services/authToken';
import { usersService } from '../../services/users.service';
import { LocationPoint, Service } from '../../types/jobs';
import { Vehicle } from '../../types/vehicles';

// Default seeded services per Sahayak specifications if API reference list is loading/empty
const FALLBACK_SERVICES: Service[] = [
  { id: 1, category_id: 1, code: 'flat_tyre', name: 'Flat-Tyre Support', requires_vehicle_equipment: false, estimated_price: 350 },
  { id: 2, category_id: 1, code: 'battery_jumpstart', name: 'Battery Jumpstart', requires_vehicle_equipment: false, estimated_price: 450 },
  { id: 3, category_id: 2, code: 'minor_repair', name: 'On-Site Minor Repair', requires_vehicle_equipment: false, estimated_price: 500 },
  { id: 4, category_id: 3, code: 'flatbed_tow', name: 'Flatbed Towing', requires_vehicle_equipment: true, estimated_price: 1500 },
  { id: 5, category_id: 3, code: 'wheel_lift_tow', name: 'Wheel-Lift Towing', requires_vehicle_equipment: true, estimated_price: 1200 },
  { id: 6, category_id: 1, code: 'fuel_delivery', name: 'Emergency Fuel (5L)', requires_vehicle_equipment: false, estimated_price: 300 },
];

// Placeholder vehicle so the form is explorable without a backend. Its id is never
// accepted at submit time — see `isRealVehicleId` below.
const DEMO_VEHICLE_ID_PREFIX = 'demo-';

const DEMO_VEHICLES: Vehicle[] = [
  {
    id: `${DEMO_VEHICLE_ID_PREFIX}veh-1`,
    user_id: 'owner-1',
    vehicle_type: 'four_wheeler',
    make: 'Hyundai',
    model: 'i20',
    vehicle_number: 'KA-01-MJ-4521',
    created_at: new Date().toISOString(),
  },
];

const isRealVehicleId = (id: string) => Boolean(id) && !id.startsWith(DEMO_VEHICLE_ID_PREFIX);

export const RequestHelpPage: React.FC = () => {
  const navigate = useNavigate();

  // Queries
  const { data: serverVehicles = [], isLoading: isLoadingVehicles } = useVehicles();
  const { data: serverServices = [], isLoading: isLoadingServices } = useServices();
  const createJobMutation = useCreateJob();

  // Active services list
  const services = serverServices.length > 0 ? serverServices : FALLBACK_SERVICES;

  // Fall back to a placeholder vehicle only in demo mode. In a real build an owner
  // with no saved vehicles sees VehicleSelector's empty state instead.
  const vehicles =
    serverVehicles.length > 0 ? serverVehicles : IS_DEMO_MODE ? DEMO_VEHICLES : [];

  // Emergency-first form state: Location is step 1
  const [pickupLocation, setPickupLocation] = useState<LocationPoint>({
    lat: 12.9716,
    lng: 77.5946,
    address: 'Bengaluru Central, Karnataka',
  });

  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState<'all' | 'mechanic' | 'towing' | 'fuel'>('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(vehicles[0]?.id || '');
  const [issueDescription, setIssueDescription] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);

  // Quick emergency auth modal state if user is unauthenticated
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // One idempotency key per request draft, deliberately NOT regenerated per tap.
  // Retrying a submission that may already have reached the server must reuse the
  // same key, otherwise the retry dispatches a second partner to the same breakdown.
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  // Auto-select first vehicle when serverVehicles load or if unselected
  useEffect(() => {
    if (serverVehicles.length > 0) {
      const selectionIsStale =
        !selectedVehicleId ||
        !isRealVehicleId(selectedVehicleId) ||
        !serverVehicles.some((v) => v.id === selectedVehicleId);

      if (selectionIsStale) {
        setSelectedVehicleId(serverVehicles[0].id);
      }
    } else if (!selectedVehicleId && vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [serverVehicles, vehicles, selectedVehicleId]);

  const dispatchJob = async (serviceCode: string) => {
    try {
      const newJob = await createJobMutation.mutateAsync({
        payload: {
          vehicle_id: selectedVehicleId,
          service_code: serviceCode,
          pickup_lat: pickupLocation.lat,
          pickup_lng: pickupLocation.lng,
          pickup_address_text: pickupLocation.address,
          issue_description: issueDescription || undefined,
          issue_photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
          // Retained for backward compatibility
          service_id: selectedServiceId ?? undefined,
          pickup: pickupLocation,
        },
        idempotencyKey: idempotencyKeyRef.current,
      });

      // This draft is now committed; any later request is a genuinely new one.
      idempotencyKeyRef.current = createIdempotencyKey();

      // Redirect to live matching / tracking page
      navigate(`/owner/jobs/${newJob.id}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to dispatch request. Please try again.';
      setFormError(errorMsg);
    }
  };

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

    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (!selectedService) {
      setFormError('Please select the roadside assistance service needed.');
      return;
    }

    if (!selectedVehicleId) {
      setFormError('Please select which vehicle requires assistance.');
      return;
    }

    // A placeholder vehicle exists only to make the form explorable offline; the
    // backend has no such record, so submitting it would fail validation there.
    if (!isRealVehicleId(selectedVehicleId)) {
      setFormError('Please add a saved vehicle before requesting assistance.');
      return;
    }

    // Backend requires an auth token
    const token = getAuthToken();
    if (!token) {
      if (IS_DEMO_MODE) {
        setAuthToken('demo-token-owner-asha');
      } else {
        setShowAuthModal(true);
        return;
      }
    }

    await dispatchJob(selectedService.code);
  };

  const handleQuickAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const cleanName = authName.trim();
    const cleanPhone = authPhone.replace(/\D/g, '');

    if (!cleanName || cleanPhone.length !== 10) {
      setAuthError('Please enter your full name and a valid 10-digit mobile number.');
      return;
    }

    setAuthSubmitting(true);
    try {
      await usersService.createUser({
        name: cleanName,
        phone: `+91${cleanPhone}`,
        role: 'owner',
      });

      setShowAuthModal(false);
      const selectedService = services.find((s) => s.id === selectedServiceId);
      if (selectedService) {
        await dispatchJob(selectedService.code);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to register emergency contact.');
    } finally {
      setAuthSubmitting(false);
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

          {/* Quick Category Filter: Tow / Mechanic / All */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto" role="tablist" aria-label="Filter service types">
            <button
              type="button"
              role="tab"
              aria-selected={serviceCategoryFilter === 'all'}
              onClick={() => setServiceCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                serviceCategoryFilter === 'all'
                  ? 'bg-white text-brand-800 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Options ({services.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={serviceCategoryFilter === 'mechanic'}
              onClick={() => setServiceCategoryFilter('mechanic')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                serviceCategoryFilter === 'mechanic'
                  ? 'bg-white text-brand-800 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔧 Mechanic (On-Site)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={serviceCategoryFilter === 'towing'}
              onClick={() => setServiceCategoryFilter('towing')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                serviceCategoryFilter === 'towing'
                  ? 'bg-white text-brand-800 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🚛 Tow Truck
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={serviceCategoryFilter === 'fuel'}
              onClick={() => setServiceCategoryFilter('fuel')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                serviceCategoryFilter === 'fuel'
                  ? 'bg-white text-brand-800 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⛽ Emergency Fuel
            </button>
          </div>

          {isLoadingServices ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-slate-200 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Available services">
              {services
                .filter((service) => {
                  if (serviceCategoryFilter === 'all') return true;
                  if (serviceCategoryFilter === 'towing')
                    return service.requires_vehicle_equipment || service.code.includes('tow');
                  if (serviceCategoryFilter === 'mechanic')
                    return !service.requires_vehicle_equipment && service.code !== 'fuel_delivery';
                  if (serviceCategoryFilter === 'fuel')
                    return service.code === 'fuel_delivery';
                  return true;
                })
                .map((service) => (
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
            onAddNewVehicle={() => setIsAddVehicleOpen(true)}
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

      {/* Add Vehicle Modal */}
      <AddVehicleModal
        isOpen={isAddVehicleOpen}
        onClose={() => setIsAddVehicleOpen(false)}
        onSuccess={(v) => setSelectedVehicleId(v.id)}
      />

      {/* Quick Emergency Contact Modal if unauthenticated */}
      {showAuthModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-auth-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden p-6 space-y-4 animate-scale-up">
            <div>
              <h2 id="quick-auth-title" className="text-lg font-bold text-slate-900">
                Emergency Contact Details
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                The dispatched partner needs your contact number to coordinate arrival.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-800 text-xs"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleQuickAuthSubmit} className="space-y-3">
              <div>
                <label htmlFor="qa-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="qa-name"
                  type="text"
                  placeholder="e.g. Asha Sharma"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="qa-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                  Mobile Number
                </label>
                <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:border-brand-700 focus-within:ring-1 focus-within:ring-brand-700">
                  <span className="inline-flex items-center px-2.5 bg-slate-50 border-r border-slate-200 text-xs font-semibold text-slate-600">
                    +91
                  </span>
                  <input
                    id="qa-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="98765 43210"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="flex-1 px-3 py-2 bg-white text-sm text-slate-900 outline-none"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAuthModal(false)}
                  disabled={authSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={authSubmitting}
                >
                  Continue & Dispatch
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
