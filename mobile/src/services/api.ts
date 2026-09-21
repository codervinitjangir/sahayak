// ─── Sahayak — Mock Data & API Service ────────────────────────────────────────
import axios from "axios";
import type {
  Job,
  Partner,
  Vehicle,
  User,
  SubService,
  ServiceType,
  IncomingOffer,
} from "../types";

// ─── Axios instance ────────────────────────────────────────────────────────────
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

// ─── Request interceptor — attach auth token ───────────────────────────────────
apiClient.interceptors.request.use((config) => {
  // Token will be injected here when auth is wired up
  return config;
});

// ─── Mock Data ────────────────────────────────────────────────────────────────
export const MOCK_USER_OWNER: User = {
  id: "usr_001",
  name: "Arjun Sharma",
  phone: "+91 98765 43210",
  email: "arjun@example.com",
  role: "owner",
  rating: 4.8,
  totalJobs: 12,
  isVerified: true,
};

export const MOCK_USER_PARTNER: User = {
  id: "par_001",
  name: "Ravi Kumar",
  phone: "+91 97654 32109",
  role: "partner",
  rating: 4.9,
  totalJobs: 234,
  isVerified: true,
};

export const MOCK_VEHICLES: Vehicle[] = [
  {
    id: "veh_001",
    make: "Maruti Suzuki",
    model: "Swift",
    year: 2022,
    licensePlate: "KA 05 MN 1234",
    type: "four-wheeler",
    color: "White",
    fuelType: "petrol",
  },
  {
    id: "veh_002",
    make: "Honda",
    model: "Activa 6G",
    year: 2023,
    licensePlate: "KA 01 AB 5678",
    type: "two-wheeler",
    color: "Black",
    fuelType: "petrol",
  },
];

export const MOCK_PARTNER: Partner = {
  id: "par_001",
  name: "Ravi Kumar",
  phone: "+91 97654 32109",
  rating: 4.9,
  totalJobs: 234,
  services: ["battery", "tyre", "mechanic", "towing"],
  isOnline: true,
  location: { latitude: 12.9716, longitude: 77.5946 },
  distanceKm: 1.4,
  etaMinutes: 8,
  vehicleNumber: "KA 03 XY 4567",
  vehicleModel: "Tata Ace",
  isVerified: true,
  earningsToday: 1450,
  earningsTotal: 128400,
};

export const MOCK_SUB_SERVICES: Record<ServiceType, SubService[]> = {
  battery: [
    { id: "bat_01", name: "Jump Start", estimatedPrice: 299 },
    { id: "bat_02", name: "Battery Replacement", estimatedPrice: 2499 },
    { id: "bat_03", name: "Battery Check & Charge", estimatedPrice: 199 },
  ],
  tyre: [
    { id: "tyr_01", name: "Puncture Repair", estimatedPrice: 199 },
    { id: "tyr_02", name: "Tyre Replacement", estimatedPrice: 799 },
    { id: "tyr_03", name: "Tyre Inflation", estimatedPrice: 99 },
  ],
  towing: [
    { id: "tow_01", name: "Local Tow (< 5km)", estimatedPrice: 499 },
    { id: "tow_02", name: "City Tow (5–15km)", estimatedPrice: 999 },
    { id: "tow_03", name: "Long Distance Tow", estimatedPrice: 1999 },
  ],
  fuel: [
    { id: "fue_01", name: "Petrol Delivery (2L)", estimatedPrice: 299 },
    { id: "fue_02", name: "Diesel Delivery (2L)", estimatedPrice: 289 },
    { id: "fue_03", name: "CNG Emergency", estimatedPrice: 199 },
  ],
  lockout: [
    { id: "loc_01", name: "Key Unlocking", estimatedPrice: 499 },
    { id: "loc_02", name: "Spare Key Fetch", estimatedPrice: 249 },
    { id: "loc_03", name: "Lock Repair", estimatedPrice: 799 },
  ],
  mechanic: [
    { id: "mec_01", name: "On-Site Diagnosis", estimatedPrice: 299 },
    { id: "mec_02", name: "Minor Repair", estimatedPrice: 599 },
    { id: "mec_03", name: "Engine Breakdown", estimatedPrice: 1499 },
  ],
};

export const MOCK_JOBS: Job[] = [
  {
    id: "job_001",
    ownerId: "usr_001",
    partnerId: "par_001",
    vehicleId: "veh_001",
    vehicle: MOCK_VEHICLES[0],
    serviceType: "battery",
    status: "complete",
    pickupLocation: {
      latitude: 12.9716,
      longitude: 77.5946,
      address: "MG Road, Bengaluru",
    },
    estimatedPrice: 299,
    finalPrice: 299,
    rating: 5,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
  },
  {
    id: "job_002",
    ownerId: "usr_001",
    vehicleId: "veh_002",
    vehicle: MOCK_VEHICLES[1],
    serviceType: "tyre",
    status: "complete",
    pickupLocation: {
      latitude: 12.9352,
      longitude: 77.6245,
      address: "Koramangala, Bengaluru",
    },
    estimatedPrice: 199,
    finalPrice: 199,
    rating: 4,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
  },
];

export const MOCK_INCOMING_OFFER: IncomingOffer = {
  jobId: "job_003",
  job: {
    id: "job_003",
    ownerId: "usr_002",
    vehicleId: "veh_003",
    vehicle: {
      id: "veh_003",
      make: "Hyundai",
      model: "Creta",
      year: 2021,
      licensePlate: "KA 02 PQ 7890",
      type: "four-wheeler",
      color: "Silver",
      fuelType: "diesel",
    },
    serviceType: "battery",
    status: "searching",
    pickupLocation: {
      latitude: 12.9816,
      longitude: 77.5996,
      address: "Indiranagar, Bengaluru",
    },
    notes: "Car won't start at all. Tried multiple times.",
    estimatedPrice: 299,
    createdAt: new Date().toISOString(),
  },
  estimatedEarning: 299,
  distanceKm: 2.1,
  etaMinutes: 7,
  expiresAt: new Date(Date.now() + 30000).toISOString(),
};

// ─── API Functions (will switch from mock to real on Phase 4) ─────────────────
export const authApi = {
  sendOTP: async (phone: string) => {
    // Mock: always succeeds
    return { success: true, message: `OTP sent to ${phone}` };
  },
  verifyOTP: async (phone: string, otp: string, role: "owner" | "partner") => {
    // Mock: any 6-digit OTP passes
    if (otp.length === 6) {
      return {
        success: true,
        token: "mock_jwt_token_" + Date.now(),
        user: role === "partner" ? MOCK_USER_PARTNER : MOCK_USER_OWNER,
      };
    }
    throw new Error("Invalid OTP");
  },
};

export const jobsApi = {
  getMyJobs: async (): Promise<Job[]> => {
    return MOCK_JOBS;
  },
  getJob: async (jobId: string): Promise<Job> => {
    const job = MOCK_JOBS.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");
    return job;
  },
  createJob: async (payload: Partial<Job>): Promise<Job> => {
    const newJob: Job = {
      id: "job_" + Date.now(),
      ownerId: "usr_001",
      vehicleId: payload.vehicleId!,
      serviceType: payload.serviceType!,
      status: "searching",
      pickupLocation: payload.pickupLocation!,
      notes: payload.notes,
      estimatedPrice: 299,
      createdAt: new Date().toISOString(),
    };
    return newJob;
  },
  getSubServices: async (serviceType: ServiceType): Promise<SubService[]> => {
    return MOCK_SUB_SERVICES[serviceType];
  },
};

export const partnerApi = {
  getPartnerStats: async () => {
    return {
      earningsToday: 1450,
      jobsToday: 5,
      earningsWeek: 8200,
      rating: 4.9,
    };
  },
  getIncomingOffer: async (): Promise<IncomingOffer | null> => {
    return MOCK_INCOMING_OFFER;
  },
  acceptOffer: async (jobId: string) => {
    return { success: true, jobId };
  },
  declineOffer: async (jobId: string) => {
    return { success: true, jobId };
  },
  toggleOnline: async (isOnline: boolean) => {
    return { success: true, isOnline };
  },
  getMatchedPartner: async (_jobId: string): Promise<Partner> => {
    return MOCK_PARTNER;
  },
};
