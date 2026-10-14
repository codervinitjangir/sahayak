import React from 'react';
import { Link } from 'react-router-dom';
import { Wrench, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const PricingSection: React.FC = () => {
  return (
    <section className="pricing-section" id="pricing" aria-labelledby="pricing-title">
      <div style={{ maxWidth: '1080px', margin: '0 auto', textAlign: 'center' }}>
        <p
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#0F766E',
            marginBottom: '8px',
          }}
        >
          Transparent Breakdown Care
        </p>
        <h2 className="pricing-section__title" id="pricing-title">
          How pricing works
        </h2>
        <p
          style={{
            maxWidth: '620px',
            margin: '0 auto 40px auto',
            fontSize: '15px',
            color: '#5B5346',
            lineHeight: 1.6,
          }}
        >
          No monthly subscription tiers, no hidden retainers, and no membership contracts. You only pay when you request roadside assistance.
        </p>

        {/* 3-Column How Pricing Works Bento */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
            marginBottom: '40px',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '32px 28px',
              border: '1px solid #E7E0D2',
              boxShadow: '0 4px 16px rgba(27,23,18,0.04)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'rgba(15, 118, 110, 0.1)',
                color: '#0F766E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <Wrench size={22} />
            </div>
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#1B1712',
                marginBottom: '10px',
              }}
            >
              Pay Per Service Only
            </h3>
            <p style={{ fontSize: '14px', color: '#5B5346', lineHeight: 1.6 }}>
              Zero commitments or ongoing memberships. Select the service you need—puncture repair, jumpstart, towing, or fuel delivery—and pay strictly for completed work.
            </p>
          </div>

          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '32px 28px',
              border: '1px solid #E7E0D2',
              boxShadow: '0 4px 16px rgba(27,23,18,0.04)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'rgba(180, 83, 9, 0.1)',
                color: '#B45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#1B1712',
                marginBottom: '10px',
              }}
            >
              On-Site Inspection
            </h3>
            <p style={{ fontSize: '14px', color: '#5B5346', lineHeight: 1.6 }}>
              A verified technician arrives at your vehicle breakdown coordinates to assess mechanical damage, puncture depth, or battery state before proceeding.
            </p>
          </div>

          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '32px 28px',
              border: '1px solid #E7E0D2',
              boxShadow: '0 4px 16px rgba(27,23,18,0.04)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'rgba(21, 128, 61, 0.1)',
                color: '#15803D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <CheckCircle2 size={22} />
            </div>
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#1B1712',
                marginBottom: '10px',
              }}
            >
              Settlement Notice
            </h3>
            <p style={{ fontSize: '14px', color: '#5B5346', lineHeight: 1.6 }}>
              Final price is confirmed when the job is completed.
            </p>
          </div>
        </div>

        {/* Action CTAs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
          }}
        >
          <Link
            to="/owner/request"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 28px',
              borderRadius: '9999px',
              backgroundColor: '#0F766E',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: '15px',
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(15,118,110,0.3)',
              transition: 'background-color 0.15s ease',
            }}
          >
            Request help
          </Link>
          <Link
            to="/partner/signup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 28px',
              borderRadius: '9999px',
              backgroundColor: '#FFFFFF',
              color: '#1B1712',
              fontWeight: 600,
              fontSize: '15px',
              border: '1.5px solid #E7E0D2',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Become a partner
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
