import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CareCard } from '../../src/components/CareCard';
import { usersService } from '../../src/services/users.service';
import { careDate, calloutsLine } from '../../src/features/care/care';

vi.mock('../../src/services/users.service', () => ({ usersService: { getMyCare: vi.fn() } }));

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const NOTE = 'Sahayak Care is being trialled. The price is the same as any other job until membership billing starts.';

beforeEach(() => vi.clearAllMocks());

describe('Sahayak Care on web (ADR-051)', () => {
  it('dates are India time and the call-out line reads plainly', () => {
    expect(careDate('2027-11-20T19:00:00Z')).toBe('21 Nov 2027'); // 00:30 IST next day
    expect(calloutsLine({ callouts_left: 3, callouts_allowed: 4 })).toBe('3 of 4 covered call-outs left');
  });

  it('a member sees the plan, the end date, what is left and the pricing note', async () => {
    vi.mocked(usersService.getMyCare).mockResolvedValue({
      membership: { id: 'm1', plan_code: 'care', plan_name: 'Sahayak Care', starts_at: '2026-11-21T06:00:00Z',
        ends_at: '2027-11-21T06:00:00Z', callouts_allowed: 4, callouts_used: 1, callouts_left: 3, active: true },
      plans: [], pricing_note: NOTE,
    });
    wrap(<CareCard />);
    expect(await screen.findByText('Covered until 21 Nov 2027')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 covered call-outs left')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('a non-member sees nothing: there is nothing to buy yet', async () => {
    vi.mocked(usersService.getMyCare).mockResolvedValue({ membership: null, plans: [], pricing_note: NOTE });
    const { container } = wrap(<CareCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
