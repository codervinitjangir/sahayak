import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Search, CreditCard, ChevronRight } from 'lucide-react';

const STEPS = [
  {
    num: '01',
    title: 'Share your location & issue',
    desc: 'Puncture, dead battery, need towing, or out of fuel — pick your vehicle issue and pinpoint your coordinates.',
    icon: MapPin,
    color: '#0F766E',
    colorLight: 'rgba(15, 118, 110, 0.1)',
    visual: (
      /* Illustration of the picker, not the picker itself. Rendered inert so
         keyboard users aren't dropped into four no-op stops. */
      <div className="hiw-visual__choices" aria-hidden="true">
        {[
          { emoji: '🔧', label: 'Puncture Repair' },
          { emoji: '🔋', label: 'Battery Jumpstart' },
          { emoji: '🚛', label: 'Towing / Flatbed' },
          { emoji: '⛽', label: 'Fuel Delivery' },
        ].map((s) => (
          <div key={s.label} className="hiw-choice">
            <span className="hiw-choice__emoji">{s.emoji}</span>
            <span className="hiw-choice__label">{s.label}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    num: '02',
    title: 'Nearest partner dispatched',
    desc: 'We match you with the closest verified partner equipped for your breakdown. Track live status as they head to your location.',
    icon: Search,
    color: '#B45309',
    colorLight: 'rgba(180, 83, 9, 0.1)',
    visual: (
      <div className="hiw-visual__match">
        <div className="hiw-match-card">
          <div className="hiw-match-card__avatar">SP</div>
          <div className="hiw-match-card__info">
            <div className="hiw-match-card__name">Verified Service Partner</div>
            <div className="hiw-match-card__role">Roadside Breakdown Specialist</div>
            <div className="hiw-match-card__stats">
              <span className="hiw-match-card__rating">KYC Verified</span>
              <span className="hiw-match-card__jobs">Active on network</span>
            </div>
          </div>
        </div>
        <div className="hiw-match-meta">
          <div className="hiw-match-meta__item hiw-match-meta__item--green">
            <span className="hiw-match-meta__dot" />
            En route to breakdown coordinates
          </div>
          <div className="hiw-match-meta__item hiw-match-meta__item--amber">
            Final price is confirmed when the job is completed.
          </div>
        </div>
      </div>
    ),
  },
  {
    num: '03',
    title: 'Track, get fixed, pay',
    desc: 'Follow your technician on the live tracking map. They resolve your issue on-site. Final price is confirmed when the job is completed.',
    icon: CreditCard,
    color: '#15803D',
    colorLight: 'rgba(21, 128, 61, 0.1)',
    visual: (
      <div className="hiw-visual__track">
        <div className="hiw-track-step hiw-track-step--done">
          <div className="hiw-track-step__indicator" />
          <span>Partner dispatched</span>
        </div>
        <div className="hiw-track-step hiw-track-step--done">
          <div className="hiw-track-step__indicator" />
          <span>En route to your location</span>
        </div>
        <div className="hiw-track-step hiw-track-step--active">
          <div className="hiw-track-step__indicator" />
          <span>Arrived — service in progress</span>
        </div>
        <div className="hiw-track-step">
          <div className="hiw-track-step__indicator" />
          <span>Service completed</span>
        </div>
      </div>
    ),
  },
];

export const TestimonialRow: React.FC = () => {
  return (
    <section className="hiw-section" id="how-it-works">
      <div className="hiw-header">
        <p className="hiw-header__eyebrow">How It Works</p>
        <h2 className="hiw-header__title">
          Roadside help in
          <br />
          <em>three simple steps.</em>
        </h2>
        <p className="hiw-header__sub">
          Book in under a minute. No app download needed.
        </p>
      </div>

      <div className="hiw-timeline">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isLast = idx === STEPS.length - 1;
          return (
            <div className="hiw-row" key={step.num}>
              {/* Left — Step content */}
              <div className="hiw-row__content">
                <div className="hiw-row__num" style={{ color: step.color }}>{step.num}</div>
                <h3 className="hiw-row__title">{step.title}</h3>
                <p className="hiw-row__desc">{step.desc}</p>
                <Link to="/owner/request" className="hiw-row__link" style={{ color: step.color }}>
                  Try it now <ChevronRight size={16} />
                </Link>
              </div>

              {/* Center — Timeline connector */}
              <div className="hiw-row__connector">
                <div className="hiw-row__icon-ring" style={{ background: step.colorLight, color: step.color }}>
                  <Icon size={22} strokeWidth={1.8} />
                </div>
                {!isLast && <div className="hiw-row__line" />}
              </div>

              {/* Right — Visual */}
              <div className="hiw-row__visual">
                {step.visual}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
