import React, { useState } from 'react';
import { MapPin, Navigation, Compass, AlertCircle } from 'lucide-react';
import { LocationPoint } from '../types/jobs';

export interface LocationPickerProps {
  location: LocationPoint | null;
  onChange: (location: LocationPoint) => void;
  disabled?: boolean;
}

// Common Bengaluru breakdown hotspots for fast zero-latency tap selection
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
}) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
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
          address: location?.address || `Live GPS Point (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
        });
      },
      (error) => {
        setIsDetecting(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setGeoError('Location permission denied. Please select an area below or type your address.');
            break;
          case error.POSITION_UNAVAILABLE:
            setGeoError('GPS position unavailable. Please pick a nearby area.');
            break;
          case error.TIMEOUT:
            setGeoError('GPS timed out. Please select from quick hotspots below.');
            break;
          default:
            setGeoError('Unable to fetch live coordinates.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  return (
    <div className="space-y-4">
      {/* Primary Emergency Action: Live GPS */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          disabled={disabled || isDetecting}
          onClick={handleGetCurrentLocation}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded-xl transition-all shadow-sm disabled:opacity-50 touch-target focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2"
        >
          <Navigation className={`w-5 h-5 ${isDetecting ? 'animate-spin' : ''}`} />
          <span>{isDetecting ? 'Detecting Precise Location...' : 'Use My Current GPS Location'}</span>
        </button>
      </div>

      {geoError && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-amber-800 text-sm" role="alert">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-700" />
          <span>{geoError}</span>
        </div>
      )}

      {/* Address & Coordinates Display */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
        <div>
          <label htmlFor="pickup-address" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
            Pickup Address / Landmark Description
          </label>
          <div className="relative">
            <MapPin className="w-5 h-5 text-brand-700 absolute left-3 top-3" aria-hidden="true" />
            <input
              id="pickup-address"
              type="text"
              disabled={disabled}
              placeholder="e.g. Near Sony World Signal, 100ft Road"
              value={location?.address || ''}
              onChange={(e) =>
                onChange({
                  lat: location?.lat || 12.9716,
                  lng: location?.lng || 77.5946,
                  address: e.target.value,
                })
              }
              className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-300 rounded-lg text-base text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200">
          <div className="flex items-center gap-1">
            <Compass className="w-4 h-4 text-slate-400" />
            <span>Target Coordinates:</span>
          </div>
          <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 font-medium">
            {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Not set'}
          </span>
        </div>
      </div>

      {/* Quick Bengaluru Hotspots */}
      <div>
        <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Or Quick Pick Bengaluru Area
        </span>
        <div className="flex flex-wrap gap-2">
          {POPULAR_AREAS.map((area) => (
            <button
              key={area.name}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  lat: area.lat,
                  lng: area.lng,
                  address: area.address,
                })
              }
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition-all ${
                location?.lat === area.lat && location?.lng === area.lng
                  ? 'bg-brand-700 text-white border-brand-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {area.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
