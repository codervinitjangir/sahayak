import React, { useState } from 'react';
import { X, Car, Bike, AlertCircle } from 'lucide-react';
import { useCreateVehicle } from '../features/vehicles/hooks';
import { Vehicle, VehicleType } from '../types/vehicles';
import { Button } from './ui/Button';

export interface AddVehicleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (vehicle: Vehicle) => void;
}

export const AddVehicleModal: React.FC<AddVehicleModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [vehicleType, setVehicleType] = useState<VehicleType>('four_wheeler');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createVehicleMutation = useCreateVehicle();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanMake = make.trim();
    const cleanModel = model.trim();
    const cleanNumber = vehicleNumber.trim().toUpperCase();

    if (!cleanMake) {
      setError('Please specify the vehicle manufacturer/make.');
      return;
    }
    if (!cleanModel) {
      setError('Please specify the vehicle model.');
      return;
    }
    if (!cleanNumber || cleanNumber.length < 5) {
      setError('Please enter a valid registration number (e.g. KA-01-MJ-4521).');
      return;
    }

    try {
      const created = await createVehicleMutation.mutateAsync({
        vehicle_type: vehicleType,
        make: cleanMake,
        model: cleanModel,
        vehicle_number: cleanNumber,
      });

      setMake('');
      setModel('');
      setVehicleNumber('');
      onSuccess?.(created);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to register vehicle. Please try again.';
      setError(msg);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-vehicle-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 id="add-vehicle-title" className="text-lg font-bold text-slate-900">
              Add Vehicle
            </h2>
            <p className="text-xs text-slate-500">
              Register your vehicle for fast roadside dispatch
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-800 text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Vehicle Type Toggle */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Vehicle Type
            </label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vehicle type">
              <button
                type="button"
                role="radio"
                aria-checked={vehicleType === 'four_wheeler'}
                onClick={() => setVehicleType('four_wheeler')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-semibold transition-all ${
                  vehicleType === 'four_wheeler'
                    ? 'border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <Car className="w-4 h-4" />
                <span>Four-Wheeler</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={vehicleType === 'two_wheeler'}
                onClick={() => setVehicleType('two_wheeler')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-semibold transition-all ${
                  vehicleType === 'two_wheeler'
                    ? 'border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <Bike className="w-4 h-4" />
                <span>Two-Wheeler</span>
              </button>
            </div>
          </div>

          {/* Make and Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="veh-make" className="block text-xs font-semibold text-slate-700 mb-1">
                Make / Brand
              </label>
              <input
                id="veh-make"
                type="text"
                placeholder={vehicleType === 'four_wheeler' ? 'e.g. Hyundai' : 'e.g. Honda'}
                value={make}
                onChange={(e) => setMake(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="veh-model" className="block text-xs font-semibold text-slate-700 mb-1">
                Model
              </label>
              <input
                id="veh-model"
                type="text"
                placeholder={vehicleType === 'four_wheeler' ? 'e.g. i20' : 'e.g. Activa'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
                required
              />
            </div>
          </div>

          {/* Registration Number */}
          <div>
            <label htmlFor="veh-reg" className="block text-xs font-semibold text-slate-700 mb-1">
              Vehicle Registration Number
            </label>
            <input
              id="veh-reg"
              type="text"
              placeholder="e.g. KA-01-MJ-4521"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 font-mono uppercase bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Standard RTO registration number matching your vehicle plates.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={createVehicleMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={createVehicleMutation.isPending}
            >
              Save Vehicle
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
