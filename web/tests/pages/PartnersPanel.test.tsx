import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PartnersPanel } from '../../src/pages/admin/PartnersPanel';
import { adminService } from '../../src/services/admin.service';

vi.mock('../../src/services/admin.service', async (orig) => {
  const real = await orig<typeof import('../../src/services/admin.service')>();
  return {
    ...real,
    adminService: { listPartners: vi.fn(), getPartner: vi.fn(), verifyPartner: vi.fn(),
      viewPartnerDocument: vi.fn(), reviewPartnerDocument: vi.fn() },
  };
});

const summary = {
  id: 'p1',
  phone: '+919811122334',
  name: 'Ramesh Mechanic',
  verification_status: 'pending' as const,
  verification_note: null,
  is_available: false,
  rating_avg: null,
  rating_count: 0,
  created_at: '2026-11-01T00:00:00Z',
};
const detail = {
  ...summary,
  documents: [
    { id: 'd1', doc_type: 'driving_license', status: 'pending', has_file: true,
      rejection_reason: null, expiry_date: '2027-01-01', uploaded_at: '2026-11-01T00:00:00Z' },
  ],
  equipment: [
    { id: 'e1', equipment_type: 'flatbed', registration_number: 'KA01QA0001', verification_status: 'pending' },
  ],
};

describe('PartnersPanel review flow', () => {
  beforeEach(() => {
    vi.mocked(adminService.listPartners).mockResolvedValue({ items: [summary], total: 1 });
    vi.mocked(adminService.getPartner).mockResolvedValue(detail);
    vi.mocked(adminService.verifyPartner).mockResolvedValue({
      ...summary, verification_status: 'rejected', verification_note: 'Licence expired',
    });
  });

  it('shows documents and equipment, and will not reject without a reason', async () => {
    const user = userEvent.setup();
    render(<PartnersPanel />);

    await user.click(await screen.findByRole('button', { name: /review/i }));
    expect(await screen.findByText(/driving license/i)).toBeInTheDocument();
    expect(screen.getByText(/KA01QA0001/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reject…/i }));
    await user.click(screen.getByRole('button', { name: /confirm rejection/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reason/i);
    expect(adminService.verifyPartner).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/reason for rejection/i), 'Licence expired');
    await user.click(screen.getByRole('button', { name: /confirm rejection/i }));
    await waitFor(() =>
      expect(adminService.verifyPartner).toHaveBeenCalledWith('p1', 'rejected', 'Licence expired'),
    );
  });

  it('reviews one document: a rejection needs the reason the partner will see (ADR-038)', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.reviewPartnerDocument).mockResolvedValue(undefined);
    render(<PartnersPanel />);
    await user.click(await screen.findByRole('button', { name: /review/i }));
    await screen.findByText(/driving license/i);

    await user.click(screen.getByRole('button', { name: /^reject driving license$/i }));
    await user.click(screen.getByRole('button', { name: /send rejection of driving license/i }));
    expect(adminService.reviewPartnerDocument).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/reason the partner will see/i), 'Photo is blurred');
    await user.click(screen.getByRole('button', { name: /send rejection of driving license/i }));
    await waitFor(() => expect(adminService.reviewPartnerDocument).toHaveBeenCalledWith(
      'p1', 'd1', { status: 'rejected', reason: 'Photo is blurred' }));

    await user.click(screen.getByRole('button', { name: /^approve driving license$/i }));
    await waitFor(() => expect(adminService.reviewPartnerDocument).toHaveBeenCalledWith('p1', 'd1', { status: 'approved' }));
  });
});
