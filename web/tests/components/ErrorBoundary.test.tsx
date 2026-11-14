import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/app/ErrorBoundary';

const Boom = (): JSX.Element => {
  throw new Error('render exploded');
};

describe('ErrorBoundary', () => {
  it('replaces a crashed page with a fallback that keeps the emergency number in reach', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('link', { name: /call 112/i })).toHaveAttribute('href', 'tel:112');
    expect(screen.queryByText(/render exploded/)).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders children untouched when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
