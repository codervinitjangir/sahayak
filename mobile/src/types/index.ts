// ─── Sahayak — Shared TypeScript Types ────────────────────────────────────────

export type UserRole = "owner" | "partner";

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  avatarUrl?: string;
  rating?: number;
  totalJobs?: number;
  isVerified?: boolean;
  createdAt?: string;
}

// ─── Vehicle ──────────────────────────────────────────────────────────────────
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  type: "two-wheeler" | "four-wheeler";
  color?: string;
  fuelType?: "petrol" | "diesel" | "electric" | "cng";
}

// ─── Location ─────────────────────────────────────────────────────────────────
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Location extends LatLng {
  address?: string;
  city?: string;
  state?: string;
}

// ─── Services ─────────────────────────────────────────────────────────────────
export type ServiceType =
  | "towing"
  | "battery"
  | "tyre"
  | "lockout"
  | "mechanic";

export interface SubService {
  id: string;
  name: string;
  description?: string;
  estimatedPrice?: number;
}

// ─── Job / Request ─────────────────────────────────────────────────────────────
export type JobStatus =
  | "pending"
  | "searching"
  | "matched"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "complete"
  | "cancelled"
  | "no_match_found";

export interface Job {
  id: string;
  ownerId: string;
  partnerId?: string;
  vehicleId: string;
  vehicle?: Vehicle;
  serviceType: ServiceType;
  subServiceId?: string;
  subService?: SubService;
  status: JobStatus;
  pickupLocation: Location;
  notes?: string;
  photoUrls?: string[];
  estimatedPrice?: number;
  finalPrice?: number;
  eta?: number; // minutes
  rating?: number;
  tip?: number;
  startCode?: string; // 4-digit OTP start code
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

// ─── Partner ──────────────────────────────────────────────────────────────────
export interface Partner {
  id: string;
  name: string;
  phone: string;
  avatarUrl?: string;
  rating: number;
  totalJobs: number;
  services: ServiceType[];
  isOnline: boolean;
  location?: LatLng;
  distanceKm?: number;
  etaMinutes?: number;
  vehicleNumber?: string;
  vehicleModel?: string;
  isVerified: boolean;
  earningsToday?: number;
  earningsTotal?: number;
}

// ─── Offer (for Partner incoming offer screen) ────────────────────────────────
export interface IncomingOffer {
  jobId: string;
  job: Job;
  estimatedEarning: number;
  distanceKm: number;
  etaMinutes: number;
  expiresAt: string; // ISO timestamp, offer expires if not accepted
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Navigation Param Lists ───────────────────────────────────────────────────
export type AuthStackParamList = {
  Splash: undefined;
  Login: { role?: UserRole };
  OTPVerify: { phone: string; role: UserRole };
};

export type FlowStep =
  | "idle"
  | "service_select"
  | "pickup_location"
  | "finding_partner"
  | "partner_matched"
  | "completed";

export type OwnerStackParamList = {
  OwnerHome?: undefined;
  OwnerSettings: undefined;
  Receipt: { jobId: string };
  ReportProblem: { jobId: string; title?: string; cancelled?: boolean };
  BecomePartner?: undefined;
  OwnerFlow?: {
    initialStep?: FlowStep;
    serviceType?: ServiceType;
    pickupAddress?: string;
    /** Resume tracking an existing request (e.g. after the app was closed). */
    jobId?: string;
  };
};

export type PartnerStackParamList = {
  PartnerHome: undefined;
  IncomingOffer: { jobId: string; assignmentId?: string; offerData?: any };
  ActiveJob: { jobId: string };
  PartnerJobDone: { jobId: string };
  PartnerReviews: undefined;
  PartnerServices: undefined;
  PartnerVerification: undefined;
  PartnerSettings: undefined;
  Receipt: { jobId: string };
};
