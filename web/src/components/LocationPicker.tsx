import React, { useState } from 'react';
import { MapPin, Navigation, CheckCircle2, AlertCircle } from 'lucide-react';
import { LocationPoint } from '../types/jobs';

export interface LocationPickerProps {
  location: LocationPoint | null;
  onChange: (location: LocationPoint) => void;
  disabled?: boolean;
  /**
   * Free-text landmark ("near the blue petrol pump"). When supplied it is edited
   * independently of the coordinates, so typing never moves the pin.
   */
  landmark?: string;
  onLandmarkChange?: (value: string) => void;
}

// Approximate centres of busy Bengaluru areas, for when GPS is unavailable. They
// are a starting point only: the owner is asked to describe the exact spot.
const POPULAR_AREAS = [
  { name: 'Indiranagar 100ft Rd', lat: 12.9784, lng: 77.6408, address: '100 Feet Rd, Indiranagar, Bengaluru' },
  { name: 'Koramangala 5th Block', lat: 12.9352, lng: 77.6245, address: 'Sony World Junction, Koramangala, Bengaluru' },
  { name: 'Whitefield Main Rd', lat: 12.9698, lng: 77.7499, address: 'ITPB Road, Whitefield, Bengaluru' },
  { name: 'MG Road Metro', lat: 12.9756, lng: 77.6066, address: 'MG Road Boulevard, Bengaluru' },
  { name: 'Electronic City Toll', lat: 12.8452, lng: 77.6602, address: 'Elevated Tollway, Electronic City Phase 1, Bengaluru' },
  { name: 'Hebbal Flyover', lat: 13.0358, lng: 77.5970, address: 'Outer Ring Rd, Hebbal, Bengaluru' },
];

export const LocationPicker: React.FC<LocationPickerProps> = ({
  location,
  onChange,
  disabled = false,
  landmark,
  onLandmarkChange,
}) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Location is not supported by this browser. Pick the nearest area below.');
      return;
    }

    setIsDetecting(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsDetecting(false);
        const { latitude, longitude } = position.coords;
        onChange({
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          // Always replace the address. Keeping the previous one would leave a label
          // pointing somewhere else entirely while the coordinates say otherwise —
          // on an emergency dispatch screen that mismatch is actively misleading.
          // There is no reverse geocoding yet, so a coordinate label is the honest value.
          address: `Live GPS Point (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
        });
      },
      (error) => {
        setIsDetecting(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setGeoError('Location permission denied. Allow location in your browser, or pick the nearest area below.');
            break;
          case error.POSITION_UNAVAILABLE:
            setGeoError('Your position is not available right now. Pick the nearest area below.');
            break;
          case error.TIMEOUT:
            setGeoError('Finding your position took too long. Try again, or pick the nearest area below.');
            break;
          default:
            setGeoError('Could not get your location.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const addressValue = landmark ?? location?.address ?? '';

  const handleAddressChange = (value: string) => {
    if (onLandmarkChange) {
      onLandmarkChange(value);
    } else if (location) {
      onChange({ ...location, address: value });
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={disabled || isDetecting}
        onClick={handleGetCurrentLocation}
        className="w-full inline-flex items-center justify-center gap-2 min-h-[56px] px-4 bg-brand-700 hover:bg-brand-800 text-white text-base font-semibold rounded-control transition-colors disabled:opacity-60"
      >
        <Navigation className={`w-5 h-5 ${isDetecting ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span>{isDetecting ? 'Finding your location…' : 'Use my current location'}</span>
      </button>

      {geoError && (
        <div
          className="p-3 bg-amber-50 border border-amber-300 rounded-control flex items-start gap-2 text-amber-900 text-sm"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-700" aria-hidden="true" />
          <span>{geoError}</span>
        </div>
      )}

      {location ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-status-success" role="status">
          <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>
            Location set{' '}
            <span className="font-mono font-medium text-ink-soft tnum">
              ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})
            </span>
          </span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">No location set yet.</p>
      )}

      <div>
        <label htmlFor="pickup-address" className="block text-sm font-semibold mb-1.5">
          Landmark or address <span className="font-normal text-ink-muted">(helps your partner find you)</span>
        </label>
        <div className="relative">
          <MapPin className="w-5 h-5 text-brand-700 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="pickup-address"
            type="text"
            disabled={disabled}
            placeholder="e.g. Near Sony World Signal, 100ft Road"
            value={addressValue}
            onChange={(e) => handleAddressChange(e.target.value)}
            className="w-full min-h-[52px] pl-11 pr-3 bg-white border border-line rounded-control text-base text-ink placeholder:text-ink-muted focus:border-brand-700 focus:ring-2 focus:ring-brand-700 outline-none"
          />
        </div>
      </div>

      <div>
        <span className="block text-sm font-semibold mb-2">No GPS? Pick the nearest area</span>
        <div className="flex flex-wrap gap-2">
          {POPULAR_AREAS.map((area) => {
            const selected = location?.lat === area.lat && location?.lng === area.lng;
            return (
              <button
                key={area.name}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onChange({ lat: area.lat, lng: area.lng, address: area.address })}
                className={`min-h-[44px] px-3.5 text-sm font-medium rounded-full border transition-colors ${
                  selected
                    ? 'bg-brand-700 text-white border-brand-700'
                    : 'bg-white text-ink border-line hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {area.name}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Area pins are approximate. Describe the exact spot in the landmark field above.
        </p>
      </div>
    </div>
  );
};
