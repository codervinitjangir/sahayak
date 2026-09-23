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
    expect(calledPayload.service_code).toBe('flat_tyre');
    expect(calledPayload.pickup_lat).toBe(12.9716);
    expect(calledPayload.pickup_lng).toBe(77.5946);
    expect((calledPayload as unknown as Record<string, unknown>).user_id).toBeUndefined();
    expect(calledPayload.vehicle_id).toBe('veh-123');
    expect(calledPayload.issue_description).toBe('Punctured by a nail on 100ft road');
    expect(calledIdempotencyKey).toBeTruthy();
    expect(typeof calledIdempotencyKey).toBe('string');
  });

  it('reuses the same Idempotency-Key when a failed submit is retried', async () => {
    // The whole point of the header: a retry of a request that may already have
    // reached the server must not dispatch a second partner to the same breakdown.
    vi.mocked(jobsService.createJob).mockRejectedValue(new Error('Network unreachable'));

    renderWithProviders(<RequestHelpPage />);

    await waitFor(() => {
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Flat-Tyre Support'));

    const dispatchBtn = screen.getByRole('button', { name: /Dispatch Verified Partner/i });

    fireEvent.click(dispatchBtn);
    await waitFor(() => {
      expect(jobsService.createJob).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(dispatchBtn);
    await waitFor(() => {
      expect(jobsService.createJob).toHaveBeenCalledTimes(2);
    });

    const firstKey = vi.mocked(jobsService.createJob).mock.calls[0][1];
    const secondKey = vi.mocked(jobsService.createJob).mock.calls[1][1];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it('issues a fresh Idempotency-Key once a request has actually been created', async () => {
    vi.mocked(jobsService.createJob)
      .mockRejectedValueOnce(new Error('Network unreachable'))
      .mockResolvedValue({
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

    await waitFor(() => {
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Flat-Tyre Support'));

    const dispatchBtn = screen.getByRole('button', { name: /Dispatch Verified Partner/i });

    // Attempt 1 fails, attempt 2 succeeds — both are the same logical request.
    fireEvent.click(dispatchBtn);
    await waitFor(() => expect(jobsService.createJob).toHaveBeenCalledTimes(1));
    fireEvent.click(dispatchBtn);
    await waitFor(() => expect(jobsService.createJob).toHaveBeenCalledTimes(2));

    // Attempt 3 is a genuinely new request and must not be deduped against it.
    fireEvent.click(dispatchBtn);
    await waitFor(() => expect(jobsService.createJob).toHaveBeenCalledTimes(3));

    const calls = vi.mocked(jobsService.createJob).mock.calls;
    expect(calls[1][1]).toBe(calls[0][1]);
    expect(calls[2][1]).not.toBe(calls[1][1]);
  });

  it('never submits the offline placeholder vehicle id', async () => {
    // With no saved vehicles the form still shows a demo vehicle so it is explorable,
    // but that id does not exist server-side and must be blocked before dispatch.
    vi.mocked(vehiclesService.listVehicles).mockResolvedValue([]);

    renderWithProviders(<RequestHelpPage />);

    await waitFor(() => {
      expect(screen.getByText('Flat-Tyre Support')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Flat-Tyre Support'));

    fireEvent.click(screen.getByRole('button', { name: /Dispatch Verified Partner/i }));

    await waitFor(() => {
      expect(screen.getByText(/Please add a saved vehicle before requesting assistance/i)).toBeInTheDocument();
    });
    expect(jobsService.createJob).not.toHaveBeenCalled();
  });
});
