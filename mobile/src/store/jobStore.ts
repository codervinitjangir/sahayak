// ─── Sahayak — Job Store (Zustand) ───────────────────────────────────────────
import { create } from "zustand";
import type { Job, JobStatus, ServiceType, Location } from "../types";
import { MOCK_JOBS } from "../services/api";

interface JobState {
  // Current active job
  activeJob: Job | null;
  // OTP start code (4-digit code shown to customer to give to partner)
  startCode: string;
  // Recent completed jobs list (connected to HomeScreen)
  recentJobs: Job[];
  // Draft job being created
  draftServiceType: ServiceType | null;
  draftVehicleId: string | null;
  draftSubServiceId: string | null;
  draftPrice: number | null;
  draftNotes: string;
  draftPickupLocation: Location | null;
  // Partner online status (for partner role)
  isOnline: boolean;

  // Actions
  setActiveJob: (job: Job | null) => void;
  updateJobStatus: (jobId: string, status: JobStatus) => void;
  setStartCode: (code: string) => void;
  addCompletedJob: (job: Job) => void;
  setDraftService: (serviceType: ServiceType, vehicleId: string) => void;
  setDraftSubService: (subServiceId: string, price?: number) => void;
  setDraftPrice: (price: number | null) => void;
  setDraftNotes: (notes: string) => void;
  setDraftPickupLocation: (location: Location) => void;
  clearDraft: () => void;
  setOnline: (v: boolean) => void;
}

export const useJobStore = create<JobState>((set) => ({
  activeJob: null,
  startCode: "4821",
  recentJobs: MOCK_JOBS,
  draftServiceType: null,
  draftVehicleId: null,
  draftSubServiceId: null,
  draftPrice: null,
  draftNotes: "",
  draftPickupLocation: null,
  isOnline: false,

  setActiveJob: (job) => set({ activeJob: job }),

  updateJobStatus: (jobId, status) =>
    set((state) => ({
      activeJob:
        state.activeJob?.id === jobId
          ? { ...state.activeJob, status }
          : state.activeJob,
    })),

  setStartCode: (code) => set({ startCode: code }),

  addCompletedJob: (job) =>
    set((state) => ({
      recentJobs: [job, ...state.recentJobs.filter((j) => j.id !== job.id)],
      activeJob: null,
    })),

  setDraftService: (serviceType, vehicleId) =>
    set({ draftServiceType: serviceType, draftVehicleId: vehicleId }),

  setDraftSubService: (subServiceId, price) =>
    set({
      draftSubServiceId: subServiceId,
      ...(price !== undefined ? { draftPrice: price } : {}),
    }),

  setDraftPrice: (price) => set({ draftPrice: price }),

  setDraftNotes: (notes) => set({ draftNotes: notes }),

  setDraftPickupLocation: (location) => set({ draftPickupLocation: location }),

  clearDraft: () =>
    set({
      draftServiceType: null,
      draftVehicleId: null,
      draftSubServiceId: null,
      draftPrice: null,
      draftNotes: "",
      draftPickupLocation: null,
    }),

  setOnline: (v) => set({ isOnline: v }),
}));
