import React, { useState } from 'react';
import { Check } from 'lucide-react';

interface PricingTier {
  name: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  desc: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

const TIERS: PricingTier[] = [
  {
    name: 'Pay Per Use',
    priceMonthly: 0,
    priceAnnual: 0,
    desc: 'Zero commitment. Pay transparent fixed rates only when you need assistance.',
    features: [
      '24/7 emergency dispatch access',
      'Up to 2 saved vehicles',
      'All service types covered (puncture, battery, tow)',
      'Live GPS tracking on every job',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Family',
    priceMonthly: 499,
    priceAnnual: 399,
    desc: "Covers your household's daily drivers (cars & two-wheelers).",
    features: [
      'Up to 4 household vehicles (cars & bikes)',
      'Priority emergency dispatch',
      'Free quarterly battery & tyre checkup',
      'Dedicated family assistance line',
    ],
    cta: 'Choose Family',
  },
  {
    name: 'Fleet',
    priceMonthly: 1999,
    priceAnnual: 1599,
    desc: 'For delivery fleets, taxis & commercial businesses.',
    features: [
      'Unlimited business vehicles',
      'Fastest response guarantee (<15 min)',
      'Multi-zone Bengaluru coverage',
      'Fleet dashboard & GST invoices',
      'Team member & driver access',
    ],
    cta: 'Choose Fleet',
    featured: true,
  },
  {
    name: 'Enterprise',
    priceMonthly: null,
    priceAnnual: null,
    desc: 'For large corporate fleets & mobility operators.',
    features: [
      'Custom SLA & dedicated tow trucks',
      'Admin controls & role-based access',
      'API integration for automated dispatch',
      'Dedicated 24/7 account manager',
      'Custom rate cards & SLA reporting',
    ],
    cta: 'Talk to sales',
  },
];

export const PricingSection: React.FC = () => {
  const [isAnnual, setIsAnnual] = useState(false);

  return (
    <section className="pricing-section" id="pricing" aria-labelledby="pricing-title">
      <h2 className="pricing-section__title" id="pricing-title">
        Simple plans. Transparent rates.
      </h2>

      <div className="pricing-toggle" role="group" aria-label="Billing frequency toggle">
        <button
          type="button"
          className={`pricing-toggle__btn ${!isAnnual ? 'pricing-toggle__btn--active' : ''}`}
          onClick={() => setIsAnnual(false)}
          aria-pressed={!isAnnual}
        >
          Monthly
        </button>
        <button
          type="button"
          className={`pricing-toggle__btn ${isAnnual ? 'pricing-toggle__btn--active' : ''}`}
          onClick={() => setIsAnnual(true)}
          aria-pressed={isAnnual}
        >
          Yearly
          <span className="pricing-toggle__badge">Save 20%</span>
        </button>
      </div>

      <div className="pricing-grid">
        {TIERS.map((tier) => (
          <div key={tier.name} className={`pricing-card ${tier.featured ? 'pricing-card--featured' : ''}`}>
            {tier.featured && (
              <span className="pricing-card__featured-badge" aria-label="Most popular plan">
                ★ MOST POPULAR
              </span>
            )}
            <h3 className="pricing-card__name">{tier.name}</h3>
            <div className="pricing-card__price">
              {tier.priceMonthly === null ? (
                <>
                  <span className="pricing-card__amount">Custom</span>
                  <span className="pricing-card__subtext">Tailored SLA & volume rates</span>
                </>
              ) : tier.priceMonthly === 0 ? (
                <>
                  <span className="pricing-card__amount">₹0</span>
                  <span className="pricing-card__subtext">no monthly fee · pay per job</span>
                </>
              ) : (
                <>
                  <span className="pricing-card__amount">₹{isAnnual ? tier.priceAnnual : tier.priceMonthly}</span>
                  <span className="pricing-card__subtext">/month {isAnnual ? '(billed annually)' : ''}</span>
                </>
              )}
            </div>
            <p className="pricing-card__desc">{tier.desc}</p>
            <ul className="pricing-card__features" aria-label={`${tier.name} features`}>
              {tier.features.map((f) => (
                <li key={f} className="pricing-card__feature">
                  <Check size={16} aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`pricing-card__btn ${tier.featured ? 'pricing-card__btn--featured' : ''}`}
            >
              {tier.cta}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
