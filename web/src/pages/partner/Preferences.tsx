import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Truck,
  Wrench,
  Check,
  CheckCircle2,
  Lock,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  ChevronDown,
  ShieldCheck,
  Zap,
  Activity,
} from 'lucide-react';
import {
  PartnerProfile,
  CATEGORIES,
  servicesForCategory,
  EQUIPMENT_TYPES,
  getStoredPartnerProfile,
  saveStoredPartnerProfile,
  isTier1Complete,
  PartnerCategory,
  VehicleEquipmentType,
  VerificationItem,
} from '../../types/partner';
import { Button } from '../../components/ui/Button';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import './partner.css';

// Filter out 'fuel_delivery' per requirement
const PREFERENCE_CATEGORIES = CATEGORIES.filter((cat) => cat.code !== 'fuel_delivery');

const VEHICLE_SPECS: Record<VehicleEquipmentType, { specs: string; tag: string; capacity: string }> = {
  flatbed_truck: {
    specs: '18ft Hydraulic Tilt-Deck · 4.5T Payload · Remote Winch',
    tag: 'Accident, EV & Luxury Breakdown Safe',
    capacity: '4.5 Tonnes',
  },
  wheel_lift_truck: {
    specs: 'Underlift Boom Arm · 2.5T Payload · 1.9m Clearance',
    tag: 'Basement Extraction & Tight City Streets',
    capacity: '2.5 Tonnes',
  },
  bike_trailer: {
    specs: '3-Bike Multi-Chock Deck · 750kg Tow Rating · Low Incline',
    tag: 'Superbikes & Urban Two-Wheelers',
    capacity: '750 kg',
  },
};

export const Preferences: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PartnerProfile>(getStoredPartnerProfile);

  // Big screen step-wise navigation: Step 1 (Category) -> Step 2 (Services) -> Step 3 (Equipment/Vehicle)
  const [currentStep, setCurrentStep] = useState<number>(1);
  const totalSteps = 3;

  // Working state for the 3 steps (defaults to mechanical if previous was fuel)
  const initialCategory: PartnerCategory =
    profile.category === 'fuel_delivery' || !profile.category ? 'mechanical' : profile.category;

  const [category, setCategory] = useState<PartnerCategory>(initialCategory);
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>(() =>
    profile.services.filter((s) => s.code !== 'fuel_delivery').map((s) => s.id)
  );
  const [equipment, setEquipment] = useState<{
    type: VehicleEquipmentType;
    registrationNumber: string;
  }>(() => {
    const primaryVeh = profile.vehicles[0];
    return {
      type: primaryVeh ? primaryVeh.type : 'flatbed_truck',
      registrationNumber: primaryVeh ? primaryVeh.registrationNumber : '',
    };
  });

  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Tier 1 Identity Gating
  const tier1Complete = isTier1Complete(profile);

  // Master Availability — shared with the dashboard toggle, not a local copy.
  const { isAvailable, toggle: handleToggleMasterAvailability } = usePartnerAvailability();

  // Toggle Service in Step 2
  const handleToggleService = (serviceId: number) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  // Save changes
  const handleSavePreferences = () => {
    const availableServices = servicesForCategory(category).filter((s) => s.code !== 'fuel_delivery');
    const activeServices = availableServices.filter((s) => selectedServiceIds.includes(s.id));

    const isTowing =
      category === 'towing' ||
      category === 'both' ||
      activeServices.some((s) => s.categoryCode === 'towing');

    const cleanReg = equipment.registrationNumber.trim().toUpperCase();

    // Preserve existing verification items, add new ones if needed
    const updatedVerificationItems: VerificationItem[] = [...profile.verificationItems];

    activeServices.forEach((svc) => {
      const itemId = `svc_${svc.code}`;
      if (!updatedVerificationItems.some((v) => v.id === itemId)) {
        updatedVerificationItems.push({
          id: itemId,
          label: svc.name,
          type: 'service',
          tier: 'tier_2_capabilities',
          status: 'in_progress',
        });
      }
    });

    const updatedVehicles =
      isTowing && cleanReg
        ? [
            {
              id: profile.vehicles[0]?.id || `veh_${Date.now()}`,
              type: equipment.type,
              registrationNumber: cleanReg,
            },
          ]
        : profile.vehicles;

    if (isTowing && cleanReg) {
      const eqId = `eq_${updatedVehicles[0].id}`;
      if (!updatedVerificationItems.some((v) => v.id === eqId)) {
        updatedVerificationItems.push({
          id: eqId,
          label: `Vehicle (${cleanReg})`,
          type: 'equipment',
          tier: 'tier_2_capabilities',
          status: 'in_progress',
        });
      }
    }

    const nextProfile: PartnerProfile = {
      ...profile,
      isAvailable,
      category,
      services: activeServices.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        active: true,
      })),
      vehicles: updatedVehicles,
      verificationItems: updatedVerificationItems,
    };

    setProfile(nextProfile);
    saveStoredPartnerProfile(nextProfile);
    setIsSaved(true);
    setSaveSuccessMsg('Preferences saved and capabilities submitted for verification!');
    setTimeout(() => {
      navigate('/partner/dashboard');
    }, 1200);
  };

  const isTowing = category === 'towing' || category === 'both';
  const availableServices = servicesForCategory(category).filter((s) => s.code !== 'fuel_delivery');
  const isValidReg = /^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{1,3}\s?[0-9]{4}$/i.test(equipment.registrationNumber.trim());

  return (
    // Embedded, the console canvas already supplies the paper background and
    // the padding — repeating them here would double the gutter and nest a
    // second full-height scroll region inside the first.
    <div
      className={
        embedded ? 'text-[#1B1712] w-full' : 'min-h-screen bg-[#F6F1E6] text-[#1B1712] py-6 px-4 sm:px-6 lg:px-8'
      }
    >
      <div className={`w-full flex flex-col gap-5 ${embedded ? '' : 'max-w-6xl mx-auto'}`}>
        {/* Header Strip with Steps Badge & Navigation */}
        <header className="w-full flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[11px] font-bold tracking-wider text-[#0F766E] uppercase bg-[#0F766E]/10 px-2.5 py-0.5 rounded-full border border-[#0F766E]/20">
                  Fleet Configuration
                </span>
                <span className="text-xs font-bold text-[#1B1712]">
                  STEP {currentStep} OF {totalSteps}
                </span>
                <span className="text-[#9A917F]">·</span>
                <span className="text-xs font-medium text-[#5B5346]">
                  {currentStep === 1 && '01 Operational Scope'}
                  {currentStep === 2 && '02 Service Catalog'}
                  {currentStep === 3 && '03 Fleet & Hardware'}
                </span>
              </div>
              <h1 className="font-['Fraunces'] text-2xl sm:text-3xl font-semibold text-[#1B1712] tracking-tight">
                Fleet & Preferences
              </h1>
              <p className="text-xs text-[#5B5346] mt-0.5">
                Configure your roadside rescue capabilities, service radius, and vehicle equipment for Bengaluru dispatches
              </p>
            </div>

            {/* Quick Actions: Duty Toggle & Links */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Duty Status Switch Pill (Tested by PartnerPages.test.tsx) */}
              <div className="flex items-center gap-2 bg-white rounded-[12px] px-3.5 py-1.5 border border-[#E7E0D2] shadow-2xs text-xs">
                <span className="text-[#5B5346] font-medium text-[11px]">Status:</span>
                <span className="relative flex h-2 w-2">
                  {isAvailable && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isAvailable ? 'bg-emerald-600' : 'bg-neutral-300'
                    }`}
                  />
                </span>
                <span className="font-bold text-[#1B1712] text-[11px]">{isAvailable ? 'On Duty' : 'Off Duty'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAvailable}
                  aria-label="Toggle availability"
                  onClick={handleToggleMasterAvailability}
                  className={`toggle-switch scale-75 origin-right ${isAvailable ? 'toggle-switch--active' : ''}`}
                >
                  <span className="toggle-switch__thumb" />
                </button>
              </div>

              {/* Cross-links only when this page stands alone. Inside the
                  console the sidebar already owns navigation, and a <Link>
                  here would jump the user out of the shell. */}
              {!embedded && (
                <>
                  {/* Direct Dashboard Link */}
                  <Link
                    to="/partner/dashboard"
                    className="px-3.5 py-1.5 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs text-xs font-semibold text-[#1B1712] flex items-center gap-1.5 transition-all"
                  >
                    <Truck className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>Live Dispatches</span>
                  </Link>

                  {/* Verification & KYC Link */}
                  <Link
                    to="/partner/verification"
                    className="px-3.5 py-1.5 rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] shadow-2xs text-xs font-semibold text-[#1B1712] flex items-center gap-1.5 transition-all"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>Verification & KYC</span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Segmented Step Progress Bar */}
          <div className="flex items-center gap-2 w-full mt-2">
            {Array.from({ length: totalSteps }).map((_, idx) => {
              const isFilled = idx < currentStep;
              return (
                <div
                  key={idx}
                  className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                    isFilled ? 'bg-[#0F766E]' : 'bg-[#E7E0D2]'
                  }`}
                />
              );
            })}
          </div>
        </header>

        {/* Feedback Banner if saved */}
        {isSaved && saveSuccessMsg && (
          <div className="p-3.5 rounded-[14px] bg-[#1B1712] border border-[#3A332A] flex items-center justify-between gap-2.5 text-xs text-white shadow-sm animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0F766E] shrink-0" />
              <span className="font-semibold">{saveSuccessMsg}</span>
            </div>
            <Link
              to="/partner/dashboard"
              className="inline-flex items-center gap-1 font-bold text-[#0F766E] hover:text-white transition-colors underline underline-offset-2 shrink-0 text-xs ml-2"
            >
              <span>Opening Partner Dashboard...</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        )}

        {/* Warning if Tier 1 incomplete */}
        {!tier1Complete && (
          <div className="p-3.5 rounded-[14px] bg-[#FDF8F0] border border-[#F2C582] flex items-start gap-2.5 text-xs text-[#5B5346]">
            <Lock className="w-4 h-4 text-[#C05621] shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block mb-0.5 text-[#1B1712]">Identity Verification Required</strong>
              <span className="text-[#5B5346]">
                Complete identity verification to unlock this service for live dispatches.{' '}
                <Link to="/partner/verification" className="underline font-bold text-[#0F766E] hover:text-[#0D645D]">
                  Upload Tier 1 Documents →
                </Link>
              </span>
            </div>
          </div>
        )}

        {/* TWO-COLUMN SPLIT SCREEN (Exact Image 2 Structure) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Form Step Card (~58% on Desktop) */}
          <div className="lg:col-span-7 bg-[#FBF8F1] rounded-[16px] border border-[#E7E0D2] p-5 sm:p-6 shadow-2xs flex flex-col justify-between">
            {/* STEP 1: Category Selection (3 cards, No Fuel) */}
            {currentStep === 1 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h1 className="text-xl font-bold text-[#1B1712] mb-1">Service Category</h1>
                  <p className="text-xs text-[#5B5346] mb-4">
                    Select your primary roadside operational capability. You can offer towing, mechanical repairs, or both.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4" role="radiogroup" aria-label="Service category">
                    {PREFERENCE_CATEGORIES.map((cat) => {
                      const isSelected = category === cat.code;
                      return (
                        <div
                          key={cat.code}
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={() => setCategory(cat.code)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              setCategory(cat.code);
                            }
                          }}
                          className={`p-4 rounded-[12px] border flex flex-col justify-between cursor-pointer transition-all ${
                            isSelected
                              ? 'border-[#0F766E] bg-white ring-1 ring-[#0F766E] shadow-2xs'
                              : 'border-[#E7E0D2] hover:border-[#9A917F] bg-white/70'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              {/* Single selection indicator */}
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isSelected ? 'border-[#0F766E] bg-white' : 'border-[#E7E0D2] bg-white'
                                }`}
                              >
                                {isSelected && <span className="w-2 h-2 rounded-full bg-[#0F766E]" />}
                              </div>

                              <div className="text-[#0F766E]">
                                {cat.code === 'both' ? (
                                  <div className="flex items-center gap-1">
                                    <Truck className="w-4 h-4" />
                                    <Wrench className="w-4 h-4" />
                                  </div>
                                ) : cat.code === 'towing' ? (
                                  <Truck className="w-4 h-4" />
                                ) : (
                                  <Wrench className="w-4 h-4" />
                                )}
                              </div>
                            </div>

                            <div>
                              <span className="text-sm font-bold text-[#1B1712] block mb-1">
                                {cat.label}
                              </span>
                              <span className="text-xs text-[#5B5346] leading-tight block mb-2">
                                {cat.description}
                              </span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-[#E7E0D2] text-[10px] font-semibold text-[#5B5346]">
                            {cat.code === 'towing' && 'High Payout · Heavy Recovery'}
                            {cat.code === 'mechanical' && 'High Volume · Rapid Response'}
                            {cat.code === 'both' && 'Max Utilization · Dual Route'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-3 border-t border-[#E7E0D2]">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 !bg-[#0F766E] hover:!bg-[#0D645D] text-white border-0 rounded-[10px] shadow-xs"
                    onClick={() => setCurrentStep(2)}
                  >
                    <span>Next: Configure Services</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Service Selection */}
            {currentStep === 2 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h1 className="text-xl font-bold text-[#1B1712]">Offered Services</h1>
                    <span className="text-[11px] font-semibold text-[#5B5346] bg-white border border-[#E7E0D2] px-2.5 py-0.5 rounded-full">
                      {selectedServiceIds.length} of {availableServices.length} Selected
                    </span>
                  </div>
                  <p className="text-xs text-[#5B5346] mb-4">
                    Select all services you are equipped and certified to provide.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
                    {availableServices.map((service) => {
                      const isChecked = selectedServiceIds.includes(service.id);
                      return (
                        <div
                          key={service.id}
                          role="checkbox"
                          aria-checked={isChecked}
                          tabIndex={0}
                          onClick={() => handleToggleService(service.id)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              handleToggleService(service.id);
                            }
                          }}
                          className={`p-3 rounded-[12px] border flex items-center justify-between cursor-pointer transition-all ${
                            isChecked
                              ? 'border-[#0F766E] bg-white ring-1 ring-[#0F766E] shadow-2xs'
                              : 'border-[#E7E0D2] hover:border-[#9A917F] bg-white/70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                isChecked ? 'bg-[#0F766E] border-[#0F766E] text-white' : 'border-[#E7E0D2] bg-white'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3" />}
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-[#1B1712] block">
                                {service.name}
                              </span>
                              <span className="text-[10px] text-[#5B5346]">
                                {service.categoryCode === 'towing' ? 'Heavy Recovery SLA: 15–20m' : 'On-Site Fix SLA: 10–15m'}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-[#5B5346] bg-white border border-[#E7E0D2] px-2 py-0.5 rounded">
                            {service.categoryCode === 'towing' ? '₹1,500+' : '₹450+'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#E7E0D2]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 text-xs text-[#1B1712] border-[#E7E0D2] bg-white hover:bg-[#F6F1E6] rounded-[10px]"
                    onClick={() => setCurrentStep(1)}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 !bg-[#0F766E] hover:!bg-[#0D645D] text-white border-0 rounded-[10px] shadow-xs"
                    disabled={selectedServiceIds.length === 0}
                    onClick={() => setCurrentStep(3)}
                  >
                    <span>Next: Vehicle & Equipment</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Fleet & Equipment */}
            {currentStep === 3 && (
              <div className="flex-1 flex flex-col justify-between overflow-y-auto pr-1">
                <div>
                  <h1 className="text-xl font-bold text-[#1B1712] mb-1">Vehicles & Equipment</h1>
                  <p className="text-xs text-[#5B5346] mb-3">
                    {isTowing
                      ? 'Attach your primary recovery truck or tow vehicle.'
                      : 'Configure your mobile response vehicle or equipment kit.'}
                  </p>

                  <div className="space-y-3 mb-3">
                    {/* Vehicle Type Custom Selector */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="pref-vehicle-type" className="block text-xs font-semibold text-[#1B1712]">
                          Equipment / Vehicle Type
                        </label>
                        <span className="text-[10px] font-semibold text-[#5B5346]">
                          {VEHICLE_SPECS[equipment.type]?.capacity} Capacity
                        </span>
                      </div>
                      <div className="relative">
                        <select
                          id="pref-vehicle-type"
                          value={equipment.type}
                          onChange={(e) =>
                            setEquipment((prev) => ({
                              ...prev,
                              type: e.target.value as VehicleEquipmentType,
                            }))
                          }
                          className="partner-input w-full p-2.5 pr-8 border border-[#E7E0D2] rounded-[12px] cursor-pointer bg-white text-xs font-semibold text-[#1B1712] focus:border-[#0F766E] outline-none appearance-none"
                        >
                          {EQUIPMENT_TYPES.map((eq) => (
                            <option key={eq.code} value={eq.code}>
                              {eq.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-[#9A917F] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      {/* Vehicle Spec Capsule */}
                      <div className="mt-1.5 px-2.5 py-1.5 rounded-[10px] bg-white border border-[#E7E0D2] flex items-center justify-between text-[11px]">
                        <span className="text-[#5B5346] font-medium">
                          {VEHICLE_SPECS[equipment.type]?.specs}
                        </span>
                        <span className="text-[#9A917F] text-[10px] hidden sm:inline">
                          {VEHICLE_SPECS[equipment.type]?.tag}
                        </span>
                      </div>
                    </div>

                    {/* Registration Number with HSRP Commercial Preview */}
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label htmlFor="pref-reg-input" className="block text-xs font-semibold text-[#1B1712]">
                          Vehicle Registration Number
                        </label>
                        <span className="text-[10px] text-[#5B5346] font-medium">
                          Commercial Yellow Board
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9A917F] mb-1.5">Example: KA 01 AB 1234</p>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                        <div className="sm:col-span-6">
                          <input
                            id="pref-reg-input"
                            type="text"
                            placeholder="KA 01 AB 1234"
                            value={equipment.registrationNumber}
                            onChange={(e) =>
                              setEquipment((prev) => ({
                                ...prev,
                                registrationNumber: e.target.value,
                              }))
                            }
                            className="partner-input w-full p-2.5 border border-[#E7E0D2] rounded-[12px] text-xs font-mono uppercase font-bold text-[#1B1712] focus:border-[#0F766E] outline-none tracking-wider bg-white"
                          />
                        </div>

                        {/* Interactive Indian Commercial License Plate Preview */}
                        <div className="sm:col-span-6">
                          <div className="hsrp-plate px-3 py-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="hsrp-plate__ind">
                                <span className="text-[6px] font-bold text-amber-300">🇮🇳</span>
                                <span className="text-[8px] font-black tracking-tight">IND</span>
                              </div>
                              <span className="hsrp-plate__number text-xs sm:text-sm">
                                {equipment.registrationNumber.trim() || 'KA 01 AB 1234'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[9px] font-bold text-neutral-800/80 bg-black/5 px-1.5 py-0.5 rounded border border-black/10">
                              <ShieldCheck className="w-3 h-3 text-[#111827]" />
                              <span>HSRP</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[#5B5346]">
                        <CheckCircle2 className={`w-3.5 h-3.5 ${isValidReg ? 'text-emerald-600' : 'text-[#9A917F]'}`} />
                        <span>
                          {isValidReg
                            ? 'Commercial RTO Format Validated · Eligible for Auto-Routing'
                            : 'Enter RTO registration (e.g. State Code + District + Series + 4 Digits)'}
                        </span>
                      </div>
                    </div>

                    {/* Operational Hardware & Safety Checklist */}
                    <div className="p-3 bg-white border border-[#E7E0D2] rounded-[12px]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-[#1B1712] flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          Recovery Rigging & Hardware Compliance
                        </span>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          100% Verified
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-2 p-1.5 rounded-[8px] bg-[#FBF8F1] border border-[#E7E0D2] text-[11px] font-medium text-[#5B5346]">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>4.5T Hydraulic Winch</span>
                        </div>
                        <div className="flex items-center gap-2 p-1.5 rounded-[8px] bg-[#FBF8F1] border border-[#E7E0D2] text-[11px] font-medium text-[#5B5346]">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>EV Wheel Dollies</span>
                        </div>
                        <div className="flex items-center gap-2 p-1.5 rounded-[8px] bg-[#FBF8F1] border border-[#E7E0D2] text-[11px] font-medium text-[#5B5346]">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Heavy Ratchet Straps</span>
                        </div>
                        <div className="flex items-center gap-2 p-1.5 rounded-[8px] bg-[#FBF8F1] border border-[#E7E0D2] text-[11px] font-medium text-[#5B5346]">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>4x Safety Cones & Vest</span>
                        </div>
                      </div>
                    </div>

                    {isTowing && !equipment.registrationNumber.trim() && (
                      <div className="p-2.5 bg-[#FDF8F0] border border-[#F2C582] rounded-[12px] text-xs text-[#5B5346] flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-[#C05621] shrink-0 mt-0.5" />
                        <span>
                          Towing services require a registered vehicle before receiving automated dispatch offers.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#E7E0D2]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 text-xs text-[#1B1712] border-[#E7E0D2] bg-white hover:bg-[#F6F1E6] rounded-[10px]"
                    onClick={() => setCurrentStep(2)}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 !bg-[#0F766E] hover:!bg-[#0D645D] text-white border-0 rounded-[10px] shadow-sm"
                    onClick={handleSavePreferences}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save & Update Preferences</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Operational Telemetry & Fleet Desk (~42% on Desktop) */}
          <div className="bg-[#FBF8F1] lg:col-span-5 rounded-[16px] border border-[#E7E0D2] p-5 sm:p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden">
            <div className="relative z-10 flex flex-col gap-3">
              {/* Live Telemetry Radar Header */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F766E]">
                    Live Dispatch Telemetry · Bengaluru Grid
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-[#1B1712] leading-snug mb-1">
                  Thousands of roadside rescue requests dispatched across Bengaluru daily.
                </h2>
                <p className="text-xs text-[#5B5346] leading-relaxed">
                  Real-time partner routing telemetry across Outer Ring Road, Whitefield, Hebbal, and Central Bengaluru. Automated dispatch matches on-duty units based on vehicle readiness, verified gear, and live GPS proximity.
                </p>
              </div>

              {/* Large stats matching tests */}
              <div className="grid grid-cols-2 gap-3 py-2.5 border-t border-b border-[#E7E0D2]">
                <div>
                  <div className="text-[10px] font-bold text-[#9A917F] uppercase tracking-wider mb-0.5">
                    Verified Partners
                  </div>
                  <div className="text-2xl font-black text-[#1B1712] tracking-tight font-['Fraunces']">500+</div>
                  <span className="text-[10px] text-[#5B5346]">Active fleet across 8 zones</span>
                </div>

                <div>
                  <div className="text-[10px] font-bold text-[#9A917F] uppercase tracking-wider mb-0.5">
                    Avg Daily Earnings
                  </div>
                  <div className="text-2xl font-black text-[#1B1712] tracking-tight font-['Fraunces']">₹8,400</div>
                  <span className="text-[10px] text-[#5B5346]">Direct T+0 settlement</span>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold text-[#9A917F] uppercase tracking-wider mb-0.5">
                  Avg Dispatch Time
                </div>
                <div className="text-xl font-extrabold text-[#1B1712] tracking-tight mb-1 font-['Fraunces']">15 Mins</div>
                <p className="text-[11px] text-[#5B5346] leading-tight">
                  Smart dispatch matches partners closest to stranded vehicles for optimal route efficiency.
                </p>
              </div>

              {/* Operational Dispatch Protocols & SLA */}
              <div className="p-3 bg-white rounded-[12px] border border-[#E7E0D2] space-y-2">
                <span className="text-[10px] font-bold text-[#1B1712] block uppercase tracking-wide">
                  Dispatch SLA & Routing Standards
                </span>
                <div className="space-y-1.5 text-[11px] text-[#5B5346]">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
                    <span><strong>Proximity Dispatch:</strong> Auto-assigned within 4 km for &lt;15 min arrival</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span><strong>Commercial Yellow Board:</strong> Mandatory for highway emergency recovery</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span><strong>Direct Escrow Release:</strong> Instant bank credit upon customer OTP sign-off</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#E7E0D2] text-[10px] text-[#9A917F] relative z-10 flex items-center justify-between">
              <span>* Verified Bengaluru emergency roadside network metrics.</span>
              <span className="text-[#5B5346] font-medium">Sahayak Telemetry v2.4</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Preferences;
