import React from 'react';
import { Bike, Car, Plus, Check } from 'lucide-react';
import { Vehicle } from '../types/vehicles';

export interface VehicleSelectorProps {
  vehicles: Vehicle[];
  selectedVehicleId?: string;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onAddNewVehicle?: () => void;
  isLoading?: boolean;
}

export const VehicleSelector: React.FC<VehicleSelectorProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onAddNewVehicle,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 bg-slate-200 rounded-xl" />
        ))}
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="p-6 text-center border-2 border-dashed border-slate-300 rounded-xl bg-slate-50">
        <Car className="w-8 h-8 mx-auto text-slate-400 mb-2" aria-hidden="true" />
        <p className="text-sm text-slate-600 font-medium">No saved vehicles found.</p>
        {onAddNewVehicle && (
          <button
            type="button"
            onClick={onAddNewVehicle}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg touch-target"
          >
            <Plus className="w-4 h-4" /> Add your vehicle
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Saved vehicles">
        {vehicles.map((v) => {
          const isSelected = v.id === selectedVehicleId;
          const Icon = v.vehicle_type === 'two_wheeler' ? Bike : Car;

          return (
            <div
              key={v.id}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => onSelectVehicle(v)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onSelectVehicle(v);
                }
              }}
              className={`relative p-3.5 rounded-xl border-2 transition-all cursor-pointer touch-target flex items-center justify-between ${
                isSelected
                  ? 'border-brand-700 bg-brand-50/70 shadow-sm ring-1 ring-brand-700'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    isSelected ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-base">
                      {v.make} {v.model}
                    </span>
                  </div>
                  <div className="mt-0.5 inline-block font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium border border-slate-200 uppercase tracking-wider">
                    {v.vehicle_number}
                  </div>
                </div>
              </div>

              <div
                className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                  isSelected ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
                }`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>
            </div>
          );
        })}
      </div>

      {onAddNewVehicle && (
        <button
          type="button"
          onClick={onAddNewVehicle}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 p-1"
        >
          <Plus className="w-4 h-4" /> Add another vehicle
        </button>
      )}
    </div>
  );
};
