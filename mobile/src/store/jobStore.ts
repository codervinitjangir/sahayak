// ─── Sahayak — Job Store (Zustand) ───────────────────────────────────────────
import { create } from "zustand";
import type { Job, JobStatus, ServiceType, Location } from "../types";

interface JobState {
  // Current active job
  activeJob: Job | null;
  // Draft job being created
  draftServiceType: ServiceType | null;
  draftVehicleId: string | null;
  draftSubServiceId: string | null;
  draftNotes: string;
  draftPickupLocation: Location | null;
  // Partner online status (for partner role)
  isOnline: boolean;

  // Actions
  setActiveJob: (job: Job | null) => void;
  updateJobStatus: (jobId: string, status: JobStatus) => void;
  setDraftService: (serviceType: ServiceType, vehicleId: string) => void;
  setDraftSubService: (subServiceId: string) => void;
  setDraftNotes: (notes: string) => void;
  setDraftPickupLocation: (location: Location) => void;
  clearDraft: () => void;
  setOnline: (v: boolean) => void;
}

export const useJobStore = create<JobState>((set) => ({
  activeJob: null,
  draftServiceType: null,
  draftVehicleId: null,
  draftSubServiceId: null,
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

  setDraftService: (serviceType, vehicleId) =>
    set({ draftServiceType: serviceType, draftVehicleId: vehicleId }),

  setDraftSubService: (subServiceId) => set({ draftSubServiceId: subServiceId }),

  setDraftNotes: (notes) => set({ draftNotes: notes }),

  setDraftPickupLocation: (location) => set({ draftPickupLocation: location }),

  clearDraft: () =>
    set({
      draftServiceType: null,
      draftVehicleId: null,
      draftSubServiceId: null,
      draftNotes: "",
      draftPickupLocation: null,
    }),

  setOnline: (v) => set({ isOnline: v }),
}));
