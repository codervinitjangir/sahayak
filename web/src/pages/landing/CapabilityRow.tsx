import React from 'react';
import { MapPin, Radio, ListOrdered, Users, MessageSquare } from 'lucide-react';

const FourPointStar: React.FC<{ size?: number; color?: string }> = ({ size = 18, color = '#B45309' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
  </svg>
);

const CAPABILITIES = [
  { icon: MapPin, label: 'Doorstep Service' },
  { icon: Radio, label: 'On-Demand Dispatch' },
  { icon: ListOrdered, label: 'Transparent Pricing' },
  { icon: Users, label: 'Certified Mechanics' },
  { icon: MessageSquare, label: 'Real-Time Updates' },
];

export const CapabilityRow: React.FC = () => {
  return (
    <section className="capability-section" id="features">
      <p className="capability-section__eyebrow">
        What we offer
      </p>

      <h2 className="capability-section__heading">
        <FourPointStar size={16} color="#B45309" />
        {' '}Roadside help you can count on{' '}
        <FourPointStar size={16} color="#B45309" />
      </h2>

      <div className="capability-grid">
        {CAPABILITIES.map(({ icon: Icon, label }) => (
          <div key={label} className="capability-tile">
            <Icon className="capability-tile__icon" strokeWidth={1.5} />
            <div className="capability-tile__label">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
};
