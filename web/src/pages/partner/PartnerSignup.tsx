import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Truck,
  Wrench,
  Fuel,
  Check,
  CheckCircle2,
  AlertCircle,
  LifeBuoy,
  PhoneCall,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import {
  PartnerCategory,
  CATEGORIES,
  servicesForCategory,
  SERVICE_CATALOG,
  EQUIPMENT_TYPES,
  BASE_DOCUMENTS,
  DocumentUpload,
  EquipmentEntry,
  PartnerProfile,
  saveStoredPartnerProfile,
  VerificationItem,
  DEFAULT_OPERATIONAL_DETAILS,
} from '../../types/partner';
import { StepIndicator } from './components/StepIndicator';
import { OtpInput } from './components/OtpInput';
import { FileUploadCard } from './components/FileUploadCard';
import { Button } from '../../components/ui/Button';
import './partner.css';

const IndiaFlag: React.FC = () => (
  <svg className="w-5 h-3.5 rounded-xs shadow-xs" viewBox="0 0 640 480" aria-hidden="true">
    <path fill="#FF9933" d="M0 0h640v160H0z" />
    <path fill="#FFFFFF" d="M0 160h640v160H0z" />
    <path fill="#138808" d="M0 320h640v160H0z" />
    <circle cx="320" cy="240" r="42" fill="#000080" />
    <circle cx="320" cy="240" r="33" fill="#FFFFFF" />
    <circle cx="320" cy="240" r="11" fill="#000080" />
  </svg>
);

const OTP_COUNTDOWN_SECONDS = 30;

export const PartnerSignup: React.FC = () => {
  const navigate = useNavigate();

  // Wizard Step State (Reordered per Twilio Brand-before-Campaign requirement):
  // 0: Phone + OTP
  // 1: Tier 1 Documents (Aadhaar, PAN, Driving Licence) - gates subsequent capabilities
  // 2: Category (Tow, Mechanic, Both, Fuel)
  // 3: Services
  // 4: Equipment (Towing only)
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // Form Data
  const [phone, setPhone] = useState<string>('');
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [otp, setOtp] = useState<string>('');
  const [otpTimer, setOtpTimer] = useState<number>(OTP_COUNTDOWN_SECONDS);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  // Tier 1 Identity Documents: Aadhaar, PAN, DL
  const [tier1Documents, setTier1Documents] = useState<DocumentUpload[]>(() =>
    BASE_DOCUMENTS.map((doc) => ({ ...doc }))
  );

  const [category, setCategory] = useState<PartnerCategory | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>([]);
  const [equipment, setEquipment] = useState<EquipmentEntry>({
    type: 'flatbed_truck',
    registrationNumber: '',
  });

  const isTowing =
    category === 'towing' ||
    category === 'both' ||
    selectedServiceIds.includes(4) ||
    selectedServiceIds.includes(5);

  const steps = isTowing
    ? ['Phone', 'Documents', 'Category', 'Services', 'Equipment']
    : ['Phone', 'Documents', 'Category', 'Services'];

  // Resend OTP Countdown timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (otpSent && otpTimer > 0) {
      timerRef.current = setTimeout(() => {
        setOtpTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [otpSent, otpTimer]);

  // Auto-advance after success
  useEffect(() => {
    if (isSuccess) {
      const redirectTimer = setTimeout(() => {
        navigate('/partner/verification', { replace: true });
      }, 1500);
      return () => clearTimeout(redirectTimer);
    }
  }, [isSuccess, navigate]);

  // Handlers
  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length < 10) {
      setOtpError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setOtpError(null);
    setOtpSent(true);
    setOtpTimer(OTP_COUNTDOWN_SECONDS);
  };

  const handleResendOtp = () => {
    if (otpTimer > 0) return;
    setOtp('');
    setOtpError(null);
    setOtpTimer(OTP_COUNTDOWN_SECONDS);
  };

  const handleVerifyOtp = () => {
    if (otp.length < 6) {
      setOtpError('Please enter all 6 digits of the OTP.');
      return;
    }
    setOtpError(null);
    setCurrentStep(1); // Proceed to Tier 1 Identity Documents
  };

  const handleTier1FileSelect = (index: number, file: File) => {
    const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const lowerName = file.name.toLowerCase();
    const isValid = validExtensions.some((ext) => lowerName.endsWith(ext));

    if (!isValid) {
      setDocError('Please upload a valid document file (PDF, JPG, PNG, WEBP under 10MB).');
      return;
    }

    setDocError(null);
    setTier1Documents((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], fileName: file.name };
      return updated;
    });
  };

  const handleTier1FileRemove = (index: number) => {
    setTier1Documents((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], fileName: undefined };
      return updated;
    });
  };

  const handleFillSampleDocs = () => {
    setTier1Documents([
      { type: 'aadhaar', label: 'Aadhaar Card', fileName: 'aadhaar_front_back.pdf' },
      { type: 'pan', label: 'PAN Card', fileName: 'pan_card_scanned.jpg' },
      { type: 'driving_licence', label: 'Driving Licence', fileName: 'driving_licence_commercial.pdf' },
    ]);
    setDocError(null);
  };

  const handleCategorySelect = (selected: PartnerCategory) => {
    setCategory(selected);
    // Pre-select all services for this category by default
    const catServices = servicesForCategory(selected);
    setSelectedServiceIds(catServices.map((s) => s.id));
  };

  const handleToggleService = (serviceId: number) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    } else {
      navigate('/');
    }
  };

  const handleSubmit = () => {
    // Generate verification items based on the Two-Tier model:
    // Tier 1 (Identity): in_progress (submitted for verification)
    // Tier 2 (Capabilities): not_started (gated by Tier 1 approval)
    const verificationItems: VerificationItem[] = [];

    // 1. Tier 1 Identity Documents
    tier1Documents.forEach((doc) => {
      verificationItems.push({
        id: `doc_${doc.type}`,
        label: doc.label,
        type: 'document',
        tier: 'tier_1_identity',
        status: doc.fileName ? 'in_progress' : 'not_started',
      });
    });

    // 2. Tier 2 Capabilities (Services)
    const activeServices = SERVICE_CATALOG.filter((s) =>
      selectedServiceIds.includes(s.id)
    );
    activeServices.forEach((svc) => {
      verificationItems.push({
        id: `svc_${svc.code}`,
        label: svc.name,
        type: 'service',
        tier: 'tier_2_capabilities',
        status: 'not_started', // Gated until Tier 1 clears
      });
    });

    // 3. Tier 2 Capabilities (Equipment / Vehicles)
    if (isTowing && equipment.registrationNumber.trim()) {
      verificationItems.push({
        id: 'eq_vehicle_01',
        label: `Vehicle (${equipment.registrationNumber.trim().toUpperCase()})`,
        type: 'equipment',
        tier: 'tier_2_capabilities',
        status: 'not_started', // Gated until Tier 1 clears
      });
    }

    const hasTow = activeServices.some((s) => s.categoryCode === 'towing');
    const hasMech = activeServices.some((s) => s.categoryCode === 'mechanical');
    const resolvedCategory: PartnerCategory =
      hasTow && hasMech ? 'both' : (category || 'mechanical');

    const newProfile: PartnerProfile = {
      id: `ptr_${Date.now()}`,
      phone: `+91 ${phone}`,
      name: `Partner (+91 ${phone.slice(-4)})`,
      category: resolvedCategory,
      isAvailable: true,
      services: activeServices.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        active: true,
      })),
      vehicles:
        isTowing && equipment.registrationNumber.trim()
          ? [
              {
                id: `veh_${Date.now()}`,
                type: equipment.type,
                registrationNumber: equipment.registrationNumber.trim().toUpperCase(),
              },
            ]
          : [],
      verificationItems,
      extraDetails: {
        ...DEFAULT_OPERATIONAL_DETAILS,
        towTruckType: equipment.type,
        towRegistrationNumber: equipment.registrationNumber.trim()
          ? equipment.registrationNumber.trim().toUpperCase()
          : DEFAULT_OPERATIONAL_DETAILS.towRegistrationNumber,
      },
      sampleJobCompleted: false,
    };

    saveStoredPartnerProfile(newProfile);
    setIsSuccess(true);
  };

  const isTier1UploadComplete = tier1Documents.every((d) => Boolean(d.fileName));

  // Success view
  if (isSuccess) {
    return (
      <div className="partner-signup">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-brand-700 font-extrabold text-xl tracking-tight">
              <div className="p-1.5 rounded-lg bg-brand-700 text-white">
                <LifeBuoy className="w-5 h-5" />
              </div>
              <span>Sahayak</span>
            </Link>
          </div>
        </header>
        <main className="partner-signup__content flex items-center justify-center py-16 px-4">
          <div className="signup-success bg-white p-8 rounded-2xl border border-slate-200 shadow-sm max-w-md w-full text-center">
            <div className="signup-success__icon w-14 h-14 bg-teal-50 text-brand-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10" aria-hidden="true" />
            </div>
            <h1 className="signup-success__title text-2xl font-bold text-slate-900 mb-2">
              Application Submitted!
            </h1>
            <p className="signup-success__subtitle text-sm text-slate-600 mb-4">
              Your Tier 1 Identity documents are in review. Redirecting to your verification console...
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="partner-signup min-h-screen bg-slate-50 flex flex-col">
      {/* Top Desktop Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-brand-700 font-extrabold text-xl tracking-tight">
              <div className="p-1.5 rounded-lg bg-brand-700 text-white">
                <LifeBuoy className="w-5 h-5" />
              </div>
              <span>Sahayak</span>
            </Link>
            <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
              Partner Onboarding Console
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-medium">
              <PhoneCall className="w-3.5 h-3.5 text-brand-700" />
              <span>Partner Desk: <strong>1800-SAHAYAK</strong></span>
            </div>
            <Link
              to="/login"
              className="text-xs font-semibold text-slate-700 hover:text-brand-700 px-3.5 py-2 rounded-xl border border-slate-200 hover:border-brand-300 bg-white hover:bg-slate-50 transition-all shadow-xs"
            >
              Already registered? Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container: Single-Column Centered Layout */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Numbered-dot Step Indicator */}
        <div className="mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <StepIndicator steps={steps} currentStep={currentStep} />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 min-h-[560px] flex flex-col justify-between">
          <div>
            {/* STEP 0: Phone + OTP */}
                {currentStep === 0 && (
                  <div>
                    <div className="mb-6 pb-4 border-b border-slate-100">
                      <h1 className="partner-signup__title">
                        {otpSent ? 'Verify your number' : 'Partner Sign In / Sign Up'}
                      </h1>
                      <p className="partner-signup__subtitle mb-0">
                        {otpSent
                          ? `Enter the 6-digit OTP sent to +91 ${phone}`
                          : 'Enter your phone number to receive roadside job requests.'}
                      </p>
                    </div>

                    {!otpSent ? (
                      <form onSubmit={handleSendOtp} className="max-w-xl space-y-6">
                        <div>
                          <label htmlFor="phone-input" className="block text-sm font-semibold text-slate-700 mb-2">
                            Phone Number
                          </label>
                          <div className="phone-input-group flex items-center border-2 border-slate-200 rounded-xl overflow-hidden focus-within:border-brand-700 focus-within:ring-2 focus-within:ring-brand-700/20 transition-all bg-white">
                            <span className="phone-input-group__prefix px-3.5 py-3 bg-slate-100 text-slate-700 font-bold border-r border-slate-200 text-sm flex items-center gap-2">
                              <IndiaFlag />
                              <span>+91</span>
                            </span>
                            <input
                              id="phone-input"
                              type="tel"
                              pattern="[0-9]*"
                              maxLength={10}
                              value={phone}
                              onChange={(e) => {
                                setPhone(e.target.value.replace(/\D/g, ''));
                                setOtpError(null);
                              }}
                              placeholder="98765 43210"
                              className="partner-input flex-1 px-4 py-3 text-base outline-none font-medium text-slate-900 placeholder:text-slate-400"
                              autoFocus
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                            <span>We will send a 6-digit code to verify your fleet mobile number.</span>
                            <button
                              type="button"
                              onClick={() => {
                                setPhone('9876543210');
                                setOtpError(null);
                              }}
                              className="text-brand-700 hover:text-brand-800 font-semibold hover:underline flex-shrink-0 ml-2"
                            >
                              Fill sample
                            </button>
                          </div>
                        </div>

                        {otpError && (
                          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{otpError}</span>
                          </div>
                        )}

                        <div className="pt-2">
                          <Button
                            type="submit"
                            variant="primary"
                            className="w-full sm:w-auto sm:min-w-[200px] h-12 text-sm font-bold"
                            disabled={phone.replace(/\D/g, '').length < 10}
                          >
                            Send OTP
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="max-w-xl space-y-6">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <label className="block text-sm font-semibold text-slate-700">
                              6-Digit Verification Code
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setOtpSent(false);
                                setOtp('');
                                setOtpError(null);
                              }}
                              className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                            >
                              Change phone number
                            </button>
                          </div>
                          <div className="py-2">
                            <OtpInput value={otp} onChange={setOtp} length={6} />
                          </div>
                        </div>

                        {otpError && (
                          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{otpError}</span>
                          </div>
                        )}

                        <div className="otp-resend flex items-center justify-between text-xs text-slate-500 py-1">
                          <span>Didn't receive the SMS code?</span>
                          {otpTimer > 0 ? (
                            <span>
                              Resend OTP in <strong>{otpTimer}s</strong>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={handleResendOtp}
                              className="otp-resend__link font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                            >
                              Resend OTP
                            </button>
                          )}
                        </div>

                        <div className="pt-2">
                          <Button
                            type="button"
                            variant="primary"
                            className="w-full sm:w-auto sm:min-w-[220px] h-12 text-sm font-bold"
                            disabled={otp.length < 6}
                            onClick={handleVerifyOtp}
                          >
                            Verify & Continue
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 1: Tier 1 Identity Documents (Gates Tier 2) */}
                {currentStep === 1 && (
                  <div>
                    <div className="mb-6 pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider bg-brand-100 text-brand-800 px-2.5 py-0.5 rounded-full">
                            Tier 1 · Hard Prerequisite
                          </span>
                        </div>
                        <h1 className="partner-signup__title">Upload Identity Documents</h1>
                        <p className="partner-signup__subtitle mb-0">
                          Aadhaar, PAN, and Driving Licence are required prerequisites before configuring services or equipment.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleFillSampleDocs}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200 transition-colors self-start sm:self-center shrink-0"
                      >
                        Autofill sample docs
                      </button>
                    </div>

                    <div className="mb-5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-600">
                      <Lock className="w-4 h-4 text-brand-700 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-slate-800 block font-semibold mb-0.5">
                          Twilio A2P 10DLC Brand-before-Campaign Pattern
                        </strong>
                        Identity documents gate all capability and fleet onboarding. You cannot submit services or equipment until all three Tier 1 documents pass format validation.
                      </div>
                    </div>

                    {docError && (
                      <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{docError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {tier1Documents.map((doc, idx) => (
                        <FileUploadCard
                          key={doc.type}
                          label={doc.label}
                          fileName={doc.fileName}
                          onFileSelect={(file) => handleTier1FileSelect(idx, file)}
                          onRemove={() => handleTier1FileRemove(idx)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 2: Category Selection */}
                {currentStep === 2 && (
                  <div>
                    <div className="mb-6 pb-4 border-b border-slate-100">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full">
                          Tier 2 · Capabilities
                        </span>
                      </div>
                      <h1 className="partner-signup__title">Select Your Service Capability</h1>
                      <p className="partner-signup__subtitle mb-0">
                        Choose whether you provide towing, mechanical repairs, or both.
                      </p>
                    </div>

                    <div className="category-cards" role="radiogroup" aria-label="Primary service category">
                      {CATEGORIES.map((cat) => {
                        const isSelected = category === cat.code;

                        return (
                          <div
                            key={cat.code}
                            role="radio"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => handleCategorySelect(cat.code)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                handleCategorySelect(cat.code);
                              }
                            }}
                            className={`category-card ${isSelected ? 'category-card--selected' : ''}`}
                          >
                            <div className="category-card__header flex items-center justify-between">
                              {/* Single selection indicator: plain radio in fixed top-left position */}
                              <div className="category-card__radio">
                                {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
                              </div>

                              {/* Category icon in top-right */}
                              <div className="category-card__icon">
                                {cat.code === 'both' ? (
                                  <div className="flex items-center gap-1">
                                    <Truck className="w-5 h-5" />
                                    <Wrench className="w-5 h-5" />
                                  </div>
                                ) : cat.code === 'towing' ? (
                                  <Truck className="w-5 h-5" />
                                ) : cat.code === 'mechanical' ? (
                                  <Wrench className="w-5 h-5" />
                                ) : (
                                  <Fuel className="w-5 h-5" />
                                )}
                              </div>
                            </div>

                            <div className="category-card__text">
                              <span className="category-card__label">{cat.label}</span>
                              <span className="category-card__desc">{cat.description}</span>
                            </div>

                            <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400">
                              {cat.code === 'both'
                                ? '⚡ Tow trucks + Mobile mechanic tools'
                                : cat.code === 'towing'
                                ? '🚛 Flatbed & wheel-lift recovery'
                                : cat.code === 'mechanical'
                                ? '🔧 Tyre, jumpstart & minor repair'
                                : '⛽ On-demand emergency fuel'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* STEP 3: Services Multi-Select */}
                {currentStep === 3 && category && (
                  <div>
                    <div className="mb-6 pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full">
                            Tier 2 · Capabilities
                          </span>
                        </div>
                        <h1 className="partner-signup__title">Offered Services</h1>
                        <p className="partner-signup__subtitle mb-0">
                          Select all services you are equipped and qualified to provide.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const allIds = servicesForCategory(category).map((s) => s.id);
                            setSelectedServiceIds(allIds);
                          }}
                          className="text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200 transition-colors"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedServiceIds([])}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    <div className="service-checks">
                      {category === 'both' ? (
                        <div className="col-span-full space-y-6">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                              <Truck className="w-4 h-4 text-brand-700" />
                              <span>Towing Services</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {servicesForCategory('both')
                                .filter((s) => s.categoryCode === 'towing')
                                .map((service) => {
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
                                      className={`service-check ${isChecked ? 'service-check--selected' : ''}`}
                                    >
                                      {/* Single selection indicator: plain checkbox in fixed position */}
                                      <div className="service-check__box">
                                        {isChecked && <Check className="w-3.5 h-3.5" />}
                                      </div>
                                      <span className="service-check__label">{service.name}</span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                              <Wrench className="w-4 h-4 text-brand-700" />
                              <span>Mechanical & On-Site Services</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {servicesForCategory('both')
                                .filter((s) => s.categoryCode === 'mechanical')
                                .map((service) => {
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
                                      className={`service-check ${isChecked ? 'service-check--selected' : ''}`}
                                    >
                                      {/* Single selection indicator: plain checkbox in fixed position */}
                                      <div className="service-check__box">
                                        {isChecked && <Check className="w-3.5 h-3.5" />}
                                      </div>
                                      <span className="service-check__label">{service.name}</span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      ) : (
                        servicesForCategory(category).map((service) => {
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
                              className={`service-check ${isChecked ? 'service-check--selected' : ''}`}
                            >
                              {/* Single selection indicator: plain checkbox in fixed position */}
                              <div className="service-check__box">
                                {isChecked && <Check className="w-3.5 h-3.5" />}
                              </div>
                              <span className="service-check__label">{service.name}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* STEP 4 (Conditional): Equipment (Towing only) */}
                {currentStep === 4 && isTowing && (
                  <div>
                    <div className="mb-6 pb-4 border-b border-slate-100">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full">
                          Tier 2 · Equipment Capability
                        </span>
                      </div>
                      <h1 className="partner-signup__title">Tow Vehicle Details</h1>
                      <p className="partner-signup__subtitle mb-0">
                        Provide information about your primary rescue or recovery vehicle.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl">
                      <div>
                        <label htmlFor="equipment-type" className="block text-sm font-semibold text-slate-700 mb-2">
                          Vehicle Type
                        </label>
                        <select
                          id="equipment-type"
                          value={equipment.type}
                          onChange={(e) =>
                            setEquipment((prev) => ({
                              ...prev,
                              type: e.target.value as EquipmentEntry['type'],
                            }))
                          }
                          className="partner-input w-full p-3 border-2 border-slate-200 rounded-xl cursor-pointer bg-white text-sm font-medium text-slate-900 focus:border-brand-700 outline-none"
                        >
                          {EQUIPMENT_TYPES.map((eq) => (
                            <option key={eq.code} value={eq.code}>
                              {eq.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="reg-input" className="block text-sm font-semibold text-slate-700 mb-1">
                          Vehicle Registration Number
                        </label>
                        {/* Field example text directly under the label, above input */}
                        <p className="text-xs text-slate-500 mb-2">Example: KA 01 AB 1234</p>
                        <input
                          id="reg-input"
                          type="text"
                          placeholder="KA 01 AB 1234"
                          value={equipment.registrationNumber}
                          onChange={(e) =>
                            setEquipment((prev) => ({
                              ...prev,
                              registrationNumber: e.target.value.toUpperCase(),
                            }))
                          }
                          className="partner-input uppercase font-mono w-full p-3 border-2 border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:border-brand-700 outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 max-w-2xl flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-brand-700 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-slate-900 block font-semibold mb-0.5">
                          Per-Capability Verification
                        </strong>
                        Each vehicle and equipment item verifies independently once your Tier 1 identity documents clear.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Navigation Actions inside Card */}
              {currentStep > 0 && (
                <div className="partner-signup__footer flex items-center justify-between pt-6 border-t border-slate-200 mt-8">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </Button>

                  <div className="text-xs text-slate-500 hidden sm:block">
                    Step {currentStep + 1} of {steps.length} • {steps[currentStep]}
                  </div>

                  {/* Step 1: Documents Next */}
                  {currentStep === 1 && (
                    <Button
                      type="button"
                      variant="primary"
                      className="px-6 py-2.5 text-sm font-bold min-w-[160px]"
                      disabled={!isTier1UploadComplete}
                      onClick={() => setCurrentStep(2)}
                    >
                      Continue ({tier1Documents.filter((d) => d.fileName).length}/3 uploaded)
                    </Button>
                  )}

                  {/* Step 2: Category Next */}
                  {currentStep === 2 && (
                    <Button
                      type="button"
                      variant="primary"
                      className="px-6 py-2.5 text-sm font-bold min-w-[140px]"
                      disabled={!category}
                      onClick={() => setCurrentStep(3)}
                    >
                      Continue
                    </Button>
                  )}

                  {/* Step 3: Services Next or Submit (if not towing) */}
                  {currentStep === 3 && (
                    <Button
                      type="button"
                      variant="primary"
                      className="px-6 py-2.5 text-sm font-bold min-w-[160px]"
                      disabled={selectedServiceIds.length === 0}
                      onClick={() => {
                        if (isTowing) {
                          setCurrentStep(4);
                        } else {
                          handleSubmit();
                        }
                      }}
                    >
                      {isTowing
                        ? `Continue to Equipment (${selectedServiceIds.length} selected)`
                        : 'Submit for Verification'}
                    </Button>
                  )}

                  {/* Step 4: Equipment Submit (if towing) */}
                  {currentStep === 4 && isTowing && (
                    <Button
                      type="button"
                      variant="primary"
                      className="px-6 py-2.5 text-sm font-bold min-w-[180px]"
                      disabled={!equipment.registrationNumber.trim()}
                      onClick={handleSubmit}
                    >
                      Submit for Verification
                    </Button>
                  )}
                </div>
              )}
            </div>
      </main>
    </div>
  );
};

export default PartnerSignup;
