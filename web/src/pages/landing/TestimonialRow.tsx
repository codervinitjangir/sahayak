import React from 'react';
import { MapPin, Search, CreditCard, ChevronRight } from 'lucide-react';

const STEPS = [
  {
    num: '01',
    title: 'Share your location & issue',
    desc: 'Puncture, dead battery, need towing, or out of fuel — just pick your issue and drop a pin. Takes 30 seconds.',
    icon: MapPin,
    color: '#0F766E',
    colorLight: 'rgba(15, 118, 110, 0.1)',
    visual: (
      <div className="hiw-visual__choices">
        {[
          { emoji: '🔧', label: 'Puncture Repair', time: '~15 min' },
          { emoji: '🔋', label: 'Battery Jumpstart', time: '~10 min' },
          { emoji: '🚛', label: 'Towing / Flatbed', time: '~25 min' },
          { emoji: '⛽', label: 'Fuel Delivery', time: '~20 min' },
        ].map((s) => (
          <button key={s.label} className="hiw-choice" type="button">
            <span className="hiw-choice__emoji">{s.emoji}</span>
            <span className="hiw-choice__label">{s.label}</span>
            <span className="hiw-choice__time">{s.time}</span>
          </button>
        ))}
      </div>
    ),
  },
  {
    num: '02',
    title: 'Nearest partner dispatched',
    desc: 'We auto-match you with the closest certified partner who can fix your issue. You get their name, rating, and live ETA.',
    icon: Search,
    color: '#B45309',
    colorLight: 'rgba(180, 83, 9, 0.1)',
    visual: (
      <div className="hiw-visual__match">
        <div className="hiw-match-card">
          <div className="hiw-match-card__avatar">RM</div>
          <div className="hiw-match-card__info">
            <div className="hiw-match-card__name">Rajesh M.</div>
            <div className="hiw-match-card__role">Puncture & Tyre Specialist</div>
            <div className="hiw-match-card__stats">
              <span className="hiw-match-card__rating">★ 4.9</span>
              <span className="hiw-match-card__jobs">240+ jobs done</span>
            </div>
          </div>
        </div>
        <div className="hiw-match-meta">
          <div className="hiw-match-meta__item hiw-match-meta__item--green">
            <span className="hiw-match-meta__dot" />
            1.2 km away · Arriving in 6 min
          </div>
          <div className="hiw-match-meta__item hiw-match-meta__item--amber">
            Puncture repair: ₹199 (fixed rate)
          </div>
        </div>
      </div>
    ),
  },
  {
    num: '03',
    title: 'Track, get fixed, pay',
    desc: 'Watch your mechanic arrive on a live map. They fix the issue at your doorstep. Pay the pre-agreed amount — no surprises.',
    icon: CreditCard,
    color: '#15803D',
    colorLight: 'rgba(21, 128, 61, 0.1)',
    visual: (
      <div className="hiw-visual__track">
        <div className="hiw-track-step hiw-track-step--done">
          <div className="hiw-track-step__indicator" />
          <span>Partner dispatched</span>
          <span className="hiw-track-step__time">12:04 PM</span>
        </div>
        <div className="hiw-track-step hiw-track-step--done">
          <div className="hiw-track-step__indicator" />
          <span>En route to your location</span>
          <span className="hiw-track-step__time">12:05 PM</span>
        </div>
        <div className="hiw-track-step hiw-track-step--active">
          <div className="hiw-track-step__indicator" />
          <span>Arrived — repair in progress</span>
          <span className="hiw-track-step__time">12:11 PM</span>
        </div>
        <div className="hiw-track-step">
          <div className="hiw-track-step__indicator" />
          <span>Fixed & paid ₹199</span>
          <span className="hiw-track-step__time">—</span>
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
                <a href="/owner/request" className="hiw-row__link" style={{ color: step.color }}>
                  Try it now <ChevronRight size={16} />
                </a>
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
