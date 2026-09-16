export type VehicleType = 'two_wheeler' | 'four_wheeler';

export interface Vehicle {
  id: string;
  user_id: string;
  vehicle_type: VehicleType;
  make: string;
  model: string;
  vehicle_number: string;
  created_at: string;
}

export interface CreateVehiclePayload {
  vehicle_type: VehicleType;
  make: string;
  model: string;
  vehicle_number: string;
}
