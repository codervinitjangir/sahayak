import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, LifeBuoy, RefreshCw } from 'lucide-react';
import { useVehicles } from '../../features/vehicles/hooks';
import { useServices, useCreateJob } from '../../features/jobs/hooks';
import { ApiError, createIdempotencyKey } from '../../services/api';
import { SlotPicker } from '../../components/Booking';
import { bookingError, useTranslation } from '../../i18n';
import type { ScheduleSlot } from '../../features/jobs/schedule';
import { LocationPicker } from '../../components/LocationPicker';
import { ServiceCard } from '../../components/ServiceCard';
import { VehicleSelector } from '../../components/VehicleSelector';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { AddVehicleModal } from '../../components/AddVehicleModal';
import { SafetyStrip } from '../../components/SafetyStrip';
import { getAuthToken } from '../../services/authToken';
import { usersService } from '../../services/users.service';
import { LocationPoint } from '../../types/jobs';

type CategoryFilter = 'all' | 'mechanic' | 'towing';

const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mechanic', label: 'On-site repair' },
  { id: 'towing', label: 'Tow truck' },
];

const StepHeading: React.FC<{ n: number; id: string; children: React.ReactNode; required?: boolean }> = ({
  n,
  id,
  children,
  required = true,
}) => (
  <div className="flex items-center justify-between gap-3">
    <h2 id={id} className="text-lg font-bold flex items-center gap-3">
      <span
        className={`w-7 h-7 rounded-full text-sm font-bold inline-flex items-center justify-center tnum ${
          required ? 'bg-brand-700 text-white' : 'bg-slate-200 text-ink-soft'
        }`}
        aria-hidden="true"
      >
        {n}
      </span>
      <span>{children}</span>
    </h2>
    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
      {required ? 'Required' : 'Optional'}
    </span>
  </div>
);

export const RequestHelpPage: React.FC = () => {
  const navigate = useNavigate();

  const { data: vehicles = [], isLoading: isLoadingVehicles } = useVehicles();
  const {
    data: services = [],
    isLoading: isLoadingServices,
    isError: servicesFailed,
    refetch: refetchServices,
  } = useServices();
  const createJobMutation = useCreateJob();

  // There is deliberately no default pin. A partner is sent to whatever is here, so
  // it has to come from the device's GPS or from an area the owner chose.
  const [pickupLocation, setPickupLocation] = useState<LocationPoint | null>(null);
  const [landmark, setLandmark] = useState('');

  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(vehicles[0]?.id || '');
  const [issueDescription, setIssueDescription] = useState('');
  // ADR-050: book a time instead of help now.
  const [bookLater, setBookLater] = useState(false);
  const { t } = useTranslation();
  const [slot, setSlot] = useState<ScheduleSlot | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);

  // Quick registration modal when a verified account has no profile yet
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // One idempotency key per request draft, deliberately NOT regenerated per tap.
  // Retrying a submission that may already have reached the server must reuse the
  // same key, otherwise the retry dispatches a second partner to the same breakdown.
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  useEffect(() => {
    if (vehicles.length > 0) {
      const selectionIsStale = !selectedVehicleId || !vehicles.some((v) => v.id === selectedVehicleId);
      if (selectionIsStale) setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);

  const dispatchJob = async (serviceCode: string, location: LocationPoint) => {
    const addressText = landmark.trim() || location.address;
    try {
      const newJob = await createJobMutation.mutateAsync({
        payload: {
          vehicle_id: selectedVehicleId,
          service_code: serviceCode,
          pickup_lat: location.lat,
          pickup_lng: location.lng,
          pickup_address_text: addressText,
          issue_description: issueDescription || undefined,
          scheduled_for: bookLater && slot ? slot.start : undefined,
          // Retained for backward compatibility
          service_id: selectedServiceId ?? undefined,
          pickup: { ...location, address: addressText },
        },
        idempotencyKey: idempotencyKeyRef.current,
      });

      // This draft is now committed; any later request is a genuinely new one.
      idempotencyKeyRef.current = createIdempotencyKey();
      navigate(`/owner/jobs/${newJob.id}`);
    } catch (err: unknown) {
      // A verified account with no profile yet is not an error to report, it is a
      // form to show: the token is good and registration is one POST away (ADR-011).
      const booking = err instanceof ApiError ? bookingError(err.code) : undefined;
      if (booking) {
        setFormError(booking);
        return;
      }
      if (err instanceof ApiError && err.code === 'USER_NOT_REGISTERED') {
        setShowAuthModal(true);
        return;
      }
      setFormError(err instanceof Error ? err.message : 'Could not send your request. Please try again.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!pickupLocation) {
      setFormError('Please pinpoint your emergency pickup location.');
      return;
    }

    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (!selectedService) {
      setFormError('Please select the roadside assistance service needed.');
      return;
    }

    if (!selectedVehicleId) {
      setFormError(
        vehicles.length === 0
          ? 'Please add a saved vehicle before requesting assistance.'
          : 'Please select which vehicle requires assistance.'
      );
      return;
    }

    if (bookLater && !slot) {
      setFormError(t('booking.pickTime'));
      return;
    }

    // The backend needs an authenticated session. If there is none, sign in first.
    if (!getAuthToken()) {
      navigate(`/login?redirect=${encodeURIComponent('/owner/request')}`);
      return;
    }

    await dispatchJob(selectedService.code, pickupLocation);
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
      await usersService.createUser({ name: cleanName, phone: `+91${cleanPhone}`, role: 'owner' });

      setShowAuthModal(false);
      const selectedService = services.find((s) => s.id === selectedServiceId);
      if (selectedService && pickupLocation) {
        await dispatchJob(selectedService.code, pickupLocation);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Could not save your details. Try again.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const visibleServices = services.filter((service) => {
    switch (serviceCategoryFilter) {
      case 'towing':
        return service.requires_vehicle_equipment || service.code.includes('tow');
      case 'mechanic':
        return !service.requires_vehicle_equipment;
      default:
        return true;
    }
  });

  const inputClass =
    'w-full min-h-[52px] px-3.5 bg-white border border-line rounded-control text-base text-ink placeholder:text-ink-muted focus:border-brand-700 focus:ring-2 focus:ring-brand-700 outline-none';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/owner')}
          className="w-11 h-11 -ml-2 rounded-full inline-flex items-center justify-center text-ink-soft hover:text-ink hover:bg-slate-100"
          aria-label="Go back to owner dashboard"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Request Roadside Help</h1>
          <p className="text-sm text-ink-soft">Four quick steps. Only the first three are required.</p>
        </div>
      </div>

      <SafetyStrip />

      {formError && (
        <div
          role="alert"
          className="p-4 bg-emergency-50 border border-emergency-100 rounded-control flex items-start gap-3 text-emergency-700 text-sm"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <span className="font-semibold block">We could not send your request</span>
            <span>{formError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10" noValidate>
        {/* 1. Location first: it is the one thing dispatch cannot work without. */}
        <section aria-labelledby="location-section-heading" className="space-y-4">
          <StepHeading n={1} id="location-section-heading">
            Where is your vehicle stranded?
          </StepHeading>
          <LocationPicker
            location={pickupLocation}
            onChange={setPickupLocation}
            landmark={landmark}
            onLandmarkChange={setLandmark}
          />
        </section>

        {/* 2. Service */}
        <section aria-labelledby="service-section-heading" className="space-y-4">
          <StepHeading n={2} id="service-section-heading">
            What do you need?
          </StepHeading>

          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-control overflow-x-auto"
            role="tablist"
            aria-label="Filter services"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={serviceCategoryFilter === f.id}
                onClick={() => setServiceCategoryFilter(f.id)}
                className={`min-h-[44px] px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors ${
                  serviceCategoryFilter === f.id ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {isLoadingServices ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="rectangular" height={96} className="w-full" />
              ))}
            </div>
          ) : servicesFailed || services.length === 0 ? (
            <div className="p-5 border border-line rounded-card bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-ink-soft">
                {servicesFailed
                  ? 'We could not load the list of services.'
                  : 'No services are available right now.'}
              </p>
              <button
                type="button"
                onClick={() => refetchServices()}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-control border border-line font-semibold hover:bg-slate-50"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Available services">
              {visibleServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isSelected={selectedServiceId === service.id}
                  onSelect={(s) => setSelectedServiceId(s.id)}
                />
              ))}
              {visibleServices.length === 0 && (
                <p className="text-ink-soft sm:col-span-2">No services in this group. Try &ldquo;All&rdquo;.</p>
              )}
            </div>
          )}
        </section>

        {/* 3. Vehicle */}
        <section aria-labelledby="vehicle-section-heading" className="space-y-4">
          <StepHeading n={3} id="vehicle-section-heading">
            Which vehicle?
          </StepHeading>
          <VehicleSelector
            vehicles={vehicles}
            selectedVehicleId={selectedVehicleId}
            onSelectVehicle={(v) => setSelectedVehicleId(v.id)}
            onAddNewVehicle={() => setIsAddVehicleOpen(true)}
            isLoading={isLoadingVehicles}
          />
        </section>

        {/* 4. When (ADR-050) */}
        <section aria-labelledby="when-section-heading" className="space-y-4">
          <StepHeading n={4} id="when-section-heading" required={false}>
            {t('booking.when')}
          </StepHeading>
          <div role="radiogroup" aria-label={t('booking.when')} className="flex flex-wrap gap-2">
            {[
              { v: false, label: t('booking.now') },
              { v: true, label: t('booking.bookATime') },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={bookLater === o.v}
                onClick={() => {
                  setBookLater(o.v);
                  if (!o.v) setSlot(null);
                }}
                className={`min-h-[44px] px-4 rounded-control border text-sm font-semibold ${
                  bookLater === o.v ? 'bg-ink text-white border-ink' : 'bg-white border-line'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {bookLater ? <SlotPicker value={slot?.start ?? null} onChange={setSlot} /> : null}
        </section>

        {/* 5. Notes */}
        <section aria-labelledby="details-section-heading" className="space-y-4">
          <StepHeading n={5} id="details-section-heading" required={false}>
            Anything we should know?
          </StepHeading>
          <div>
            <label htmlFor="issue-notes" className="block text-sm font-semibold mb-1.5">
              Describe what happened
            </label>
            <textarea
              id="issue-notes"
              rows={3}
              placeholder="e.g. Left rear tyre is flat, I am parked on the roadside shoulder with hazards on."
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              className={`${inputClass} py-3 resize-none`}
            />
          </div>
        </section>

        <div className="space-y-3">
          <p className="p-3 bg-slate-50 border border-line rounded-control text-sm text-ink-soft text-center">
            Final price is confirmed when the job is completed.
          </p>

          <Button
            type="submit"
            size="lg"
            variant="primary"
            isLoading={createJobMutation.isPending}
            className="w-full text-lg font-semibold min-h-[56px]"
          >
            <LifeBuoy className="w-5 h-5" aria-hidden="true" />
            <span>{bookLater ? (slot ? t('booking.bookSlot', { slot: slot.label }) : t('booking.bookThisTime')) : t('booking.requestNow')}</span>
          </Button>

          <p className="text-xs text-center text-ink-muted">
            By requesting help you agree to share your vehicle details and pickup location with eligible
            verified partners. Your phone number is shared only with the partner who takes the job.
          </p>
        </div>
      </form>

      <AddVehicleModal
        isOpen={isAddVehicleOpen}
        onClose={() => setIsAddVehicleOpen(false)}
        onSuccess={(v) => setSelectedVehicleId(v.id)}
      />

      {showAuthModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-auth-title"
        >
          <div className="bg-white rounded-sheet shadow-float max-w-md w-full p-6 space-y-4">
            <div>
              <h2 id="quick-auth-title" className="text-xl font-bold">
                One last detail
              </h2>
              <p className="text-sm text-ink-soft mt-1">
                Your partner needs your name and number to coordinate arrival.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3 bg-emergency-50 border border-emergency-100 rounded-control flex items-start gap-2 text-emergency-700 text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleQuickAuthSubmit} className="space-y-4">
              <div>
                <label htmlFor="qa-name" className="block text-sm font-semibold mb-1.5">
                  Full name
                </label>
                <input
                  id="qa-name"
                  type="text"
                  placeholder="e.g. Asha Sharma"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className={inputClass}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="qa-phone" className="block text-sm font-semibold mb-1.5">
                  Mobile number
                </label>
                <div className="flex rounded-control border border-line overflow-hidden focus-within:border-brand-700 focus-within:ring-2 focus-within:ring-brand-700">
                  <span className="inline-flex items-center px-3 bg-slate-50 border-r border-line text-sm font-semibold text-ink-soft">
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
                    className="flex-1 min-h-[52px] px-3 bg-white text-base outline-none tnum"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
                <Button type="button" variant="outline" onClick={() => setShowAuthModal(false)} disabled={authSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" isLoading={authSubmitting}>
                  Continue and request
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
