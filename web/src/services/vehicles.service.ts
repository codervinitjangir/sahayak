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

  async updateVehicle(vehicleId: string, payload: Partial<CreateVehiclePayload>): Promise<Vehicle> {
    const res = await apiClient<Vehicle>(`/vehicles/${vehicleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return res.data;
  },

  async deleteVehicle(vehicleId: string): Promise<void> {
    await apiClient<void>(`/vehicles/${vehicleId}`, {
      method: 'DELETE',
    });
  },
};
