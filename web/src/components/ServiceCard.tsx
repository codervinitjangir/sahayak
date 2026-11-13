import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { serviceIcon } from './serviceIcon';
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
  const Icon = serviceIcon(service.code);

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
      className={`relative p-4 rounded-card border-2 transition-colors cursor-pointer flex flex-col justify-between min-h-[104px] ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-slate-200 bg-slate-50'
          : isSelected
          ? 'border-brand-700 bg-brand-50'
          : 'border-line bg-white hover:border-slate-300'
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
          {service.base_price && (
            <span className="text-xs font-bold text-[#0F766E] bg-teal-50 border border-teal-100 px-2 py-0.5 rounded">
              From ₹{Number(service.base_price).toLocaleString('en-IN')}
            </span>
          )}
          <span
            className={`w-5 h-5 rounded-full border flex items-center justify-center mt-1.5 ${
              isSelected ? 'border-brand-700 bg-brand-700' : 'border-slate-300 bg-white'
            }`}
          >
            {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <h4 className="text-base font-semibold text-ink">{service.name}</h4>
        {service.requires_vehicle_equipment && (
          <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Needs an equipped partner</span>
          </div>
        )}
      </div>
    </div>
  );
};
