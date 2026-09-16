import React from 'react';
import {
  Truck,
  BatteryCharging,
  CircleDot,
  Wrench,
  Fuel,
  HelpCircle,
  ShieldCheck,
} from 'lucide-react';
import { Service } from '../types/jobs';

export interface ServiceCardProps {
  service: Service;
  isSelected: boolean;
  onSelect: (service: Service) => void;
  disabled?: boolean;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  isSelected,
  onSelect,
  disabled = false,
}) => {
  const getIcon = (code: string) => {
    switch (code) {
      case 'flatbed_tow':
      case 'wheel_lift_tow':
      case 'towing':
        return Truck;
      case 'battery_jumpstart':
      case 'battery':
        return BatteryCharging;
      case 'flat_tyre':
      case 'tyre':
        return CircleDot;
      case 'minor_repair':
      case 'repair':
        return Wrench;
      case 'fuel_delivery':
      case 'fuel':
        return Fuel;
      default:
        return HelpCircle;
    }
  };

  const Icon = getIcon(service.code);

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect(service)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          onSelect(service);
        }
      }}
      className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer touch-target flex flex-col justify-between ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-slate-200 bg-slate-50'
          : isSelected
          ? 'border-brand-700 bg-brand-50/60 shadow-sm ring-1 ring-brand-700'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`p-2.5 rounded-lg ${
            isSelected ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'
          }`}
        >
          <Icon className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col items-end">
          <span
            className={`w-5 h-5 rounded-full border flex items-center justify-center ${
              isSelected ? 'border-brand-700 bg-brand-700' : 'border-slate-300 bg-white'
            }`}
          >
            {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
          </span>
          {service.estimated_price && (
            <span className="text-sm font-semibold text-slate-900 mt-2">
              ₹{service.estimated_price}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <h4 className="text-base font-semibold text-slate-900">{service.name}</h4>
        {service.requires_vehicle_equipment && (
          <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <ShieldCheck className="w-3 h-3" aria-hidden="true" />
            <span>Verified Equipment Req.</span>
          </div>
        )}
      </div>
    </div>
  );
};
