import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../src/app/AuthProvider';
import { LoginPage } from '../../src/pages/auth/LoginPage';

/**
 * Mounts the login page with owner/partner destinations so we can assert where
 * a completed sign-in actually lands.
 */
function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/owner" element={<div>Owner Home</div>} />
          <Route path="/owner/request" element={<div>Emergency Request</div>} />
          <Route path="/partner/preferences" element={<div>Partner Preferences</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

const otpBoxes = () => screen.getAllByRole('textbox', { name: /Digit \d/ }) as HTMLInputElement[];

/** Walks the two-step flow up to the code screen. */
async function advanceToVerifyStep() {
  fireEvent.click(screen.getByRole('button', { name: /Send verification code/i }));
  await waitFor(() => expect(screen.getByText('Enter your code')).toBeInTheDocument(), {
    timeout: 3000,
  });
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps the submit disabled until the number is the right length for the country', () => {
    renderLogin();

    const submit = screen.getByRole('button', { name: /Send verification code/i });
    expect(submit).toBeEnabled();

    // India expects 10 digits; a short number must not be submittable.
    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: '98765' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: '9876543210' } });
    expect(submit).toBeEnabled();
  });

  it('truncates the number when switching to a country with fewer digits', () => {
    renderLogin();

    const input = screen.getByLabelText(/Mobile number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9876543210' } });

    // Singapore is an 8-digit country — the extra digits must be dropped, not sent.
    fireEvent.change(screen.getByLabelText(/Country calling code/i), { target: { value: '+65' } });
    expect(input.value.replace(/\D/g, '')).toHaveLength(8);
  });

  it('shows the number the code was sent to, and can return to edit it', async () => {
    renderLogin();
    await advanceToVerifyStep();

    // Google's identity-chip idea: never guess which account you are verifying.
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Change$/i }));
    expect(screen.getByText('Get roadside help')).toBeInTheDocument();
  });

  it('advances focus across the OTP boxes as digits are typed', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    expect(boxes).toHaveLength(6);

    fireEvent.change(boxes[0], { target: { value: '4' } });
    expect(boxes[0].value).toBe('4');
    expect(document.activeElement).toBe(boxes[1]);

    // Backspace on an empty box steps back rather than trapping the caret.
    fireEvent.keyDown(boxes[1], { key: 'Backspace' });
    expect(document.activeElement).toBe(boxes[0]);
  });

  it('fills every box from a single pasted code', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    fireEvent.paste(boxes[0], {
      clipboardData: { getData: () => '824193' },
    });

    await waitFor(() => {
      expect(boxes.map((b) => b.value).join('')).toBe('824193');
    });
  });

  it('signs in automatically once the sixth digit lands', async () => {
    renderLogin();
    await advanceToVerifyStep();

    const boxes = otpBoxes();
    await act(async () => {
      fireEvent.paste(boxes[0], { clipboardData: { getData: () => '824193' } });
    });

    await waitFor(() => expect(screen.getByText('Owner Home')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('routes a partner sign-in to the partner console', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('radio', { name: /Service Partner/i }));
    await advanceToVerifyStep();

    await act(async () => {
      fireEvent.paste(otpBoxes()[0], { clipboardData: { getData: () => '111111' } });
    });

    await waitFor(() => expect(screen.getByText('Partner Preferences')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('offers an emergency path that does not require signing in', () => {
    renderLogin();

    const sos = screen.getByRole('link', { name: /Stranded right now/i });
    expect(sos).toHaveAttribute('href', '/owner/request');
  });
});
