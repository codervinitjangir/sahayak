import { apiClient } from "./client";

export interface MobileVehicle {
  id: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  vehicle_number: string;
  vehicle_type: "two_wheeler" | "four_wheeler";
  created_at: string;
}

export interface CreateVehiclePayload {
  make: string;
  model: string;
  year: number;
  vehicle_number: string;
  vehicle_type: "two_wheeler" | "four_wheeler";
}

export const vehiclesApi = {
  /** List all vehicles owned by current user (GET /api/v1/vehicles) */
  listVehicles: () =>
    apiClient
      .get<MobileVehicle[]>("/vehicles")
      .then((r) => r.data)
      .catch(() => []),

  /** Register a new vehicle (POST /api/v1/vehicles) */
  createVehicle: (payload: CreateVehiclePayload) =>
    apiClient
      .post<MobileVehicle>("/vehicles", payload)
      .then((r) => r.data),

  /** Get vehicle by ID (GET /api/v1/vehicles/{id}) */
  getVehicle: (vehicleId: string) =>
    apiClient
      .get<MobileVehicle>(`/vehicles/${vehicleId}`)
      .then((r) => r.data),
};
