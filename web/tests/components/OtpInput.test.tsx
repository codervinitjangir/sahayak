import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpInput } from '../../src/pages/partner/components/OtpInput';

/**
 * Found 2026-11-14 in a live run: typing the code into the partner sign-up
 * boxes left only the first digit, because the handler kept one character and
 * rebuilt the value from a stale copy. SMS autofill writes the whole code into
 * the first box at once, so the same defect broke the one input that is meant
 * to be effortless.
 */
describe('OtpInput', () => {
  it('spreads a whole code delivered to the first box (SMS autofill)', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Digit 1'), { target: { value: '654321' } });
    expect(onChange).toHaveBeenLastCalledWith('654321');
  });

  it('still accepts one digit at a time', () => {
    const onChange = vi.fn();
    render(<OtpInput value="65" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Digit 3'), { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith('654');
  });

  it('ignores non-digits', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Digit 1'), { target: { value: 'ab' } });
    expect(onChange).not.toHaveBeenCalledWith('ab');
  });
});
