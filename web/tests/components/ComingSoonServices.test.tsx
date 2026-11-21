import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ComingSoonServices, OWNER_COMING_SOON, PARTNER_COMING_SOON, type ComingSoonItem,
} from '../../src/components/ComingSoonServices';
import { featureInterestService } from '../../src/services/featureInterest.service';

function renderIt(side: 'owner' | 'partner' = 'owner', items: readonly ComingSoonItem[] = OWNER_COMING_SOON) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComingSoonServices side={side} items={items} />
    </QueryClientProvider>,
  );
}

async function clickNotify() {
  const btn = await screen.findByRole('button', { name: /Notify me/ });
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);
}

describe('ComingSoonServices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(featureInterestService, 'listMine').mockResolvedValue(['doorstep']);
  });

  it('owner list has no B2B card, and no card offers a booking or a price', () => {
    renderIt();
    expect(screen.getAllByText('Coming soon', { selector: 'span' })).toHaveLength(OWNER_COMING_SOON.length);
    expect(screen.queryByText(/For business/)).toBeNull();
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('owner and partner lists do not overlap', () => {
    const owner = new Set(OWNER_COMING_SOON.map((i) => i.id));
    expect(PARTNER_COMING_SOON.some((i) => owner.has(i.id))).toBe(false);
  });

  it('expands one card at a time', () => {
    renderIt();
    const [first, second] = screen.getAllByRole('button');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('registers interest and then shows the confirmation', async () => {
    const register = vi.spyOn(featureInterestService, 'register').mockResolvedValue(['doorstep', 'pickup-drop']);
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Pick-up & drop/ }));
    await clickNotify();
    await waitFor(() => expect(register).toHaveBeenCalledWith('pickup-drop'));
    expect(await screen.findByText(/We will tell you/)).toBeTruthy();
  });

  it('partner side registers a partner programme', async () => {
    vi.spyOn(featureInterestService, 'listMine').mockResolvedValue([]);
    const register = vi.spyOn(featureInterestService, 'register').mockResolvedValue(['financing']);
    renderIt('partner', PARTNER_COMING_SOON);
    fireEvent.click(screen.getByRole('button', { name: /Partner financing/ }));
    await clickNotify();
    await waitFor(() => expect(register).toHaveBeenCalledWith('financing'));
  });

  it('shows the confirmation for a feature already asked about', async () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Doorstep repair/ }));
    expect(await screen.findByText(/We will tell you/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Notify me/ })).toBeNull();
  });

  it('says so when saving fails', async () => {
    vi.spyOn(featureInterestService, 'register').mockRejectedValue(new Error('500'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Pick-up & drop/ }));
    await clickNotify();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
