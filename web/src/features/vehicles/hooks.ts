import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vehiclesService } from '../../services/vehicles.service';
import { CreateVehiclePayload } from '../../types/vehicles';

export const VEHICLES_QUERY_KEY = ['vehicles'];

export function useVehicles() {
  return useQuery({
    queryKey: VEHICLES_QUERY_KEY,
    queryFn: () => vehiclesService.listVehicles(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateVehiclePayload) => vehiclesService.createVehicle(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VEHICLES_QUERY_KEY });
    },
  });
}

// Removed 2026-10-06 with the service methods behind them: useUpdateVehicle and
// useDeleteVehicle pointed at PATCH and DELETE /vehicles/{id}, routes that do not
// exist. No screen used either hook.
