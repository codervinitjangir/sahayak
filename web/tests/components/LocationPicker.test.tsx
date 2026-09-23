import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocationPicker } from '../../src/components/LocationPicker';
import { LocationPoint } from '../../src/types/jobs';

/** Mimics the browser API, invoking the success callback with fixed coords. */
function stubGeolocationSuccess(coords: { latitude: number; longitude: number }) {
  const getCurrentPosition = vi.fn(
    (onSuccess: PositionCallback) =>
      onSuccess({ coords, timestamp: Date.now() } as GeolocationPosition)
  );
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

const SEEDED_LOCATION: LocationPoint = {
  lat: 12.9716,
  lng: 77.5946,
  address: 'Bengaluru Central, Karnataka',
};

describe('LocationPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the stale address when GPS returns a new position', async () => {
    // Regression guard: the address used to be preserved whenever one already
    // existed, so the label kept reading "Bengaluru Central" while the coordinates
    // jumped to wherever the user actually was.
    stubGeolocationSuccess({ latitude: 12.9784, longitude: 77.6408 });
    const onChange = vi.fn();

    render(<LocationPicker location={SEEDED_LOCATION} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Use My Current GPS Location/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    const next = onChange.mock.calls[0][0] as LocationPoint;
    expect(next.lat).toBe(12.9784);
    expect(next.lng).toBe(77.6408);
    expect(next.address).not.toBe(SEEDED_LOCATION.address);
    expect(next.address).toContain('12.9784');
    expect(next.address).toContain('77.6408');
  });

  it('surfaces a recoverable message when location permission is denied', async () => {
    const getCurrentPosition = vi.fn(
      (_onSuccess: PositionCallback, onError: PositionErrorCallback) =>
        onError({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError)
    );
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    const onChange = vi.fn();

    render(<LocationPicker location={SEEDED_LOCATION} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Use My Current GPS Location/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Location permission denied/i);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies both coordinates and address when a hotspot is picked', () => {
    const onChange = vi.fn();

    render(<LocationPicker location={SEEDED_LOCATION} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Indiranagar 100ft Rd/i }));

    expect(onChange).toHaveBeenCalledWith({
      lat: 12.9784,
      lng: 77.6408,
      address: '100 Feet Rd, Indiranagar, Bengaluru',
    });
  });
});
