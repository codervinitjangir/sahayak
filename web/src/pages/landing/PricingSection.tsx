import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';

interface PricingTier {
  name: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  savingsAnnual?: number;
  desc: string;
  inheritFrom?: string;
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
      '24/7 on-demand breakdown dispatch',
      'Up to 2 registered vehicles (car or bike)',
      'All core services (tyre, battery, tow, fuel)',
      'Live GPS tracking with technician ETA',
      'Upfront fixed pricing before dispatch',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Family',
    priceMonthly: 499,
    priceAnnual: 399,
    savingsAnnual: 1200, // (₹499 - ₹399) * 12 months = ₹1,200/year savings
    desc: "Covers your household's daily drivers with priority dispatch.",
    inheritFrom: 'Pay Per Use',
    features: [
      'Up to 4 household vehicles covered',
      'Priority emergency dispatch queue',
      'Free quarterly battery & tyre checkup',
      'Dedicated 24/7 family SOS line',
      'Zero surge pricing on peak holidays & rain',
    ],
    cta: 'Choose Family',
  },
  {
    name: 'Fleet',
    priceMonthly: 1999,
    priceAnnual: 1599,
    savingsAnnual: 4800, // (₹1,999 - ₹1,599) * 12 months = ₹4,800/year savings
    desc: 'For delivery fleets, taxis & commercial mobility businesses.',
    inheritFrom: 'Family',
    features: [
      'Unlimited business & commercial vehicles',
      '<15 min fastest response guarantee',
      'Fleet manager portal & live vehicle map',
      'Automated GST e-invoicing & monthly billing',
      'Driver & team multi-seat permissions',
    ],
    cta: 'Choose Fleet',
    featured: true,
  },
  {
    name: 'Enterprise',
    priceMonthly: null,
    priceAnnual: null,
    desc: 'For large corporate fleets, logistics & mobility operators.',
    inheritFrom: 'Fleet',
    features: [
      'Custom SLA agreement & dedicated flatbeds',
      'REST API integration for automated dispatch',
      'Dedicated 24/7 account manager & hotline',
      'Custom volume rate cards & net-30 terms',
      'Role-based admin controls & audit logs',
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
          <span className="pricing-toggle__badge">Save up to ₹4,800/yr</span>
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

            <div className="pricing-card__price-row">
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
                    <div className="pricing-card__cost-line">
                      <span className="pricing-card__amount">
                        ₹{isAnnual ? tier.priceAnnual?.toLocaleString('en-IN') : tier.priceMonthly.toLocaleString('en-IN')}
                      </span>
                      <span className="pricing-card__per">/month</span>
                      {isAnnual && tier.savingsAnnual && (
                        <span className="pricing-card__savings-badge">
                          Save ₹{tier.savingsAnnual.toLocaleString('en-IN')}/year
                        </span>
                      )}
                    </div>
                    <span className="pricing-card__subtext">
                      {isAnnual
                        ? 'billed annually'
                        : tier.savingsAnnual
                        ? `billed monthly · save ₹${tier.savingsAnnual.toLocaleString('en-IN')}/yr with annual`
                        : 'billed monthly'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <p className="pricing-card__desc">{tier.desc}</p>

            {/* "Everything in X, plus:" inheritance framing */}
            {tier.inheritFrom && (
              <div className="pricing-card__inherit">
                Everything in {tier.inheritFrom}, plus:
              </div>
            )}

            <ul className="pricing-card__features" aria-label={`${tier.name} features`}>
              {tier.features.map((f) => (
                <li key={f} className="pricing-card__feature">
                  <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* CTA positioned directly following feature list. Every tier points at
                the request form — the page's only real conversion path. There is no
                subscription checkout yet, so a tier-specific destination would be a lie. */}
            <Link
              to="/owner/request"
              className={`pricing-card__btn ${tier.featured ? 'pricing-card__btn--featured' : ''}`}
            >
              {tier.cta}
            </Link>

            {/* Free-tier trust microcopy directly under CTA (Pay Per Use only) */}
            {tier.priceMonthly === 0 && (
              <p className="pricing-card__microcopy">No card required.</p>
            )}
          </div>
        ))}
      </div>

      {/* Compare all features affordance */}
      <div className="pricing-compare">
        <a href="#features" className="pricing-compare__link">
          Need custom roadside fleets or enterprise SLAs? <span>Explore all platform capabilities ↑</span>
        </a>
      </div>
    </section>
  );
};

export default PricingSection;
