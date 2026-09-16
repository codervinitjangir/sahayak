import React, { useEffect } from 'react';
import './landing.css';
import { LandingNav } from './LandingNav';
import { Hero } from './Hero';
import { CapabilityRow } from './CapabilityRow';
import { TestimonialRow } from './TestimonialRow';
import { FeatureBlocks } from './FeatureBlocks';
import { PricingSection } from './PricingSection';
import { FinalCta } from './FinalCta';
import { LandingFooter } from './LandingFooter';

export const LandingPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Sahayak | Emergency Roadside Assistance — Bengaluru';
  }, []);

  return (
    <div
      className="landing-root"
      style={{
        backgroundColor: '#F6F1E6',
        minHeight: '100vh',
        color: '#1B1712',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      <LandingNav />
      <main>
        <Hero />
        <CapabilityRow />
        <TestimonialRow />
        <FeatureBlocks />
        <PricingSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
