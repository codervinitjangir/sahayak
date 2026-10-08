import { apiClient } from './api';
import { Vehicle, CreateVehiclePayload } from '../types/vehicles';

export const vehiclesService = {
  async listVehicles(): Promise<Vehicle[]> {
    const res = await apiClient<Vehicle[]>('/vehicles', {
      method: 'GET',
    });
    return res.data;
  },

  async createVehicle(payload: CreateVehiclePayload): Promise<Vehicle> {
    const res = await apiClient<Vehicle>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  async getVehicle(vehicleId: string): Promise<Vehicle> {
    const res = await apiClient<Vehicle>(`/vehicles/${vehicleId}`, {
      method: 'GET',
    });
    return res.data;
  },
};

// Removed 2026-10-06: updateVehicle (PATCH /vehicles/{id}) and deleteVehicle
// (DELETE /vehicles/{id}). Neither route exists, and neither is planned — editing
// and removing a vehicle are deferred backend work (TASKS.md). They had no call
// sites; the hooks that wrapped them were never consumed by a screen, so this
// removes dead code rather than a feature. Re-add them in the same pass that adds
// the routes, not before: a service method whose path 404s is worse than a missing
// one, because it survives a typecheck and a mocked test.
