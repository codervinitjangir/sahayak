import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LandingPage } from '../../src/pages/landing/LandingPage';

describe('LandingPage Component', () => {
  it('renders landing sections with Pairly aesthetic and honest Sahayak content', () => {
    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>
    );

    // 1. Floating Pill Nav
    expect(screen.getAllByText('Sahayak').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('For Partners')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Track Job')).toBeInTheDocument();

    // 2. Hero Section
    expect(screen.getByText(/Vehicle breakdown\?/i)).toBeInTheDocument();
    expect(screen.getByText(/We come to you/i)).toBeInTheDocument();
    expect(screen.getAllByText('Request help').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Become a partner').length).toBeGreaterThanOrEqual(1);

    // 3. 5-Capability Sparkle Strip
    expect(screen.getByText(/What we offer/i)).toBeInTheDocument();
    expect(screen.getByText(/Roadside help you can count on/i)).toBeInTheDocument();
    expect(screen.getByText('Doorstep Service')).toBeInTheDocument();
    expect(screen.getByText('On-Demand Dispatch')).toBeInTheDocument();
    expect(screen.getByText('Transparent Pricing')).toBeInTheDocument();
    expect(screen.getByText('Certified Mechanics')).toBeInTheDocument();
    expect(screen.getByText('Real-Time Updates')).toBeInTheDocument();

    // 4. How It Works Timeline
    expect(screen.getByText(/Roadside help in/i)).toBeInTheDocument();
    expect(screen.getByText(/three simple steps/i)).toBeInTheDocument();
    expect(screen.getByText('Share your location & issue')).toBeInTheDocument();
    expect(screen.getByText('Nearest partner dispatched')).toBeInTheDocument();
    expect(screen.getByText('Track, get fixed, pay')).toBeInTheDocument();
    expect(screen.getAllByText(/Final price is confirmed when the job is completed/i).length).toBeGreaterThanOrEqual(1);

    // 5. Four Alternating Pastel Bento Blocks
    expect(screen.getByText('ON-DEMAND DISPATCH')).toBeInTheDocument();
    expect(screen.getByText('LIVE TRACKING')).toBeInTheDocument();
    expect(screen.getByText('PARTNER WITH US')).toBeInTheDocument();
    expect(screen.getByText('SAFETY & TRUST')).toBeInTheDocument();

    // 6. Honest How Pricing Works Note (No fake tiers, no fake numbers)
    expect(screen.getByText(/How pricing works/i)).toBeInTheDocument();
    expect(screen.getByText('Pay Per Service Only')).toBeInTheDocument();
    expect(screen.getByText('On-Site Inspection')).toBeInTheDocument();
    expect(screen.getByText('Settlement Notice')).toBeInTheDocument();
    expect(screen.queryByText(/₹499/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enterprise/i)).not.toBeInTheDocument();

    // 7. Final CTA (No Zomato, no fake app store download dialogs)
    expect(screen.getByText(/Breakdown on the road\?/i)).toBeInTheDocument();
    expect(screen.getByText(/We're ready to dispatch/i)).toBeInTheDocument();
    expect(screen.queryByText(/Zomato/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Google Play/i)).not.toBeInTheDocument();

    // 8. Editorial Footer
    expect(screen.getByText(/Keeping Bengaluru moving safely/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ENTER YOUR EMAIL/i)).toBeInTheDocument();
    expect(screen.getByText(/2026 SAHAYAK ROAD RESCUE TECH PVT LTD/i)).toBeInTheDocument();
  });
});
