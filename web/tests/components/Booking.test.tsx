import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SlotPicker, BookingCard } from '../../src/components/Booking';
import { jobsService } from '../../src/services/jobs.service';
import { ApiError } from '../../src/services/api';
import { slotLabel } from '../../src/features/jobs/schedule';

vi.mock('../../src/services/jobs.service', () => ({
  jobsService: { getScheduleSlots: vi.fn(), reschedule: vi.fn() },
}));

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
  );

// Mon 23 Nov 10:00 and 12:00 IST, Tue 24 Nov 08:00 IST
const SLOTS = [
  { start: '2026-11-23T04:30:00Z', end: '2026-11-23T06:30:00Z', label: 'Mon 23 Nov, 10:00-12:00' },
  { start: '2026-11-23T06:30:00Z', end: '2026-11-23T08:30:00Z', label: 'Mon 23 Nov, 12:00-14:00' },
  { start: '2026-11-24T02:30:00Z', end: '2026-11-24T04:30:00Z', label: 'Tue 24 Nov, 08:00-10:00' },
];

beforeEach(() => vi.clearAllMocks());

describe('scheduled jobs on web (ADR-050)', () => {
  it('labels are India time', () => {
    expect(slotLabel(SLOTS[0].start, SLOTS[0].end)).toBe('Mon 23 Nov, 10:00-12:00');
  });

  it('picks a day, then a time from the server list', async () => {
    vi.mocked(jobsService.getScheduleSlots).mockResolvedValue({ slots: SLOTS, release_lead_min: 45 });
    const onChange = vi.fn();
    wrap(<SlotPicker value={null} onChange={onChange} />);
    expect(await screen.findByRole('radio', { name: 'Mon 23 Nov' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '12:00-14:00' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Tue 24 Nov' }));
    fireEvent.click(screen.getByRole('radio', { name: '08:00-10:00' }));
    expect(onChange).toHaveBeenLastCalledWith(SLOTS[2]);
    expect(screen.getByText(/45 minutes before your slot/)).toBeInTheDocument();
  });

  it('a failed slot list is an error with a retry, not an empty picker', async () => {
    vi.mocked(jobsService.getScheduleSlots).mockRejectedValue(new Error('down'));
    wrap(<SlotPicker value={null} onChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the available times/i);
  });

  it('moves a booking, and explains when matching already started', async () => {
    vi.mocked(jobsService.getScheduleSlots).mockResolvedValue({ slots: SLOTS, release_lead_min: 45 });
    vi.mocked(jobsService.reschedule).mockRejectedValue(
      new ApiError(409, { code: 'JOB_NOT_SCHEDULED', message: 'no' }),
    );
    const onCancel = vi.fn();
    wrap(<BookingCard jobId="j1" scheduledFor={SLOTS[0].start} slotEnd={SLOTS[0].end} onCancel={onCancel} />);
    expect(screen.getByText('Booked for Mon 23 Nov, 10:00-12:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move to another time' }));
    fireEvent.click(await screen.findByRole('radio', { name: '12:00-14:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move booking' }));
    await waitFor(() => expect(jobsService.reschedule).toHaveBeenCalledWith('j1', SLOTS[1].start));
    expect(await screen.findByRole('alert')).toHaveTextContent(/matching has already started/i);
    fireEvent.click(screen.getByRole('button', { name: 'Keep current time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
