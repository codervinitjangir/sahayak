import React, { useRef, useCallback, KeyboardEvent, ClipboardEvent } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (val: string) => void;
  length?: number;
  disabled?: boolean;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  length = 6,
  disabled = false,
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const focusInput = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, length - 1));
      inputRefs.current[clamped]?.focus();
    },
    [length]
  );

  const handleChange = (index: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const next = [...digits];
    next[index] = char;
    onChange(next.join(''));

    if (char && index < length - 1) {
      focusInput(index + 1);
    }
  };

  // The input can receive more than one character at once: SMS autofill
  // (autocomplete="one-time-code") writes the whole code into the first box,
  // and fast typing outruns the re-render. Keeping only the last character
  // dropped the rest, leaving a one-digit code the user could not finish.
  const handleInput = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 2 || (clean.length === 2 && !digits[index])) {
      const merged = (value.slice(0, index) + clean).slice(0, length);
      onChange(merged);
      focusInput(Math.min(merged.length, length - 1));
      return;
    }
    // One character typed over an existing digit arrives as two; the new one is last.
    handleChange(index, clean.slice(-1));
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        focusInput(index - 1);
      }
      handleChange(index, '');
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusInput(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted) {
      onChange(pasted);
      focusInput(Math.min(pasted.length, length - 1));
    }
  };

  return (
    <div className="otp-input-group" role="group" aria-label="OTP verification code">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          className="otp-input-group__digit"
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          onFocus={(e) => e.target.select()}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
        />
      ))}
    </div>
  );
};
