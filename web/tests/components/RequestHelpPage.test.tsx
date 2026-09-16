import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestHelpPage } from '../../src/pages/owner/RequestHelpPage';
import { jobsService } from '../../src/services/jobs.service';
import { vehiclesService } from '../../src/services/vehicles.service';

vi.mock('../../src/services/jobs.service', () => ({
  jobsService: {
    listServices: vi.fn(),
    createJob: vi.fn(),
  },
}));

vi.mock('../../src/services/vehicles.service', () => ({
  vehiclesService: {
    listVehicles: vi.fn(),
  },
}));

const mockServices = [
  {
    id: 1,
    category_id: 1,
    code: 'flat_tyre',
    name: 'Flat-Tyre Support',
    requires_vehicle_equipment: false,
    estimated_price: 350,
  },
  {
    id: 2,
    category_id: 1,
    code: 'battery_jumpstart',
    name: 'Battery Jumpstart',
    requires_vehicle_equipment: false,
    estimated_price: 450,
  },
];

const mockVehicles = [
  {
    id: 'veh-123',
    user_id: 'usr-1',
    vehicle_type: 'four_wheeler' as const,
    make: 'Hyundai',
    model: 'i20',
    vehicle_number: 'KA-01-MJ-4521',
    created_at: '2026-01-01T00:00:00Z',
  },
];

function renderWithProviders(ui: React.ReactElement) {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={testQueryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe('RequestHelpPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobsService.listServices).mockResolvedValue(mockServices);
    vi.mocked(vehiclesService.listVehicles).mockResolvedValue(mockVehicles);
  });

  it('renders the emergency-first layout with location as step 1', async () => {
    renderWithProviders(<RequestHelpPage />);

    expect(screen.getByText(/Request Roadside Help/i)).toBeInTheDocument();
    expect(screen.getByText(/Where is your vehicle stranded\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Select Service Needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Select Vehicle/i)).toBeInTheDocument();
  });

  it('displays validation error if service is not selected before dispatching', async () => {
    renderWithProviders(<RequestHelpPage />);

    const dispatchBtn = screen.getByRole('button', { name: /Dispatch Verified Partner/i });
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(screen.getByText(/Please select the roadside assistance service needed/i)).toBeInTheDocument();
    });
    expect(jobsService.createJob).not.toHaveBeenCalled();
  });

  it('submits successfully with Idempotency-Key when valid inputs are selected', async () => {
    vi.mocked(jobsService.createJob).mockResolvedValue({
      id: 'job-created-999',
      user_id: 'usr-1',
      vehicle_id: 'veh-123',
      vehicle_number: 'KA-01-MJ-4521',
      service_id: 1,
      status: 'matching',
      pickup_location: { lat: 12.9716, lng: 77.5946, address: 'Bengaluru Central, Karnataka' },
      requested_at: '2026-09-15T11:00:00Z',
    });

    renderWithProviders(<RequestHelpPage />);

    // Wait for services to load and select 'Flat-Tyre Support'
    await waitFor(() => {
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
    });

    const flatTyreOption = screen.getByText('Flat-Tyre Support');
    fireEvent.click(flatTyreOption);

    // Enter optional issue notes
    const notesInput = screen.getByPlaceholderText(/left rear tyre is flat/i);
    fireEvent.change(notesInput, { target: { value: 'Punctured by a nail on 100ft road' } });

    // Click dispatch
    const dispatchBtn = screen.getByRole('button', { name: /Dispatch Verified Partner/i });
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(jobsService.createJob).toHaveBeenCalledTimes(1);
    });

    const [calledPayload, calledIdempotencyKey] = vi.mocked(jobsService.createJob).mock.calls[0];
    expect(calledPayload.service_id).toBe(1);
    expect(calledPayload.vehicle_id).toBe('veh-123');
    expect(calledPayload.issue_description).toBe('Punctured by a nail on 100ft road');
    expect(calledIdempotencyKey).toBeTruthy();
    expect(typeof calledIdempotencyKey).toBe('string');
  });
});
