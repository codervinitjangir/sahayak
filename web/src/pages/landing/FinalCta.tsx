import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, MapPin } from 'lucide-react';

export const FinalCta: React.FC = () => {
  return (
    <section className="final-cta" id="get-help" aria-label="Roadside assistance actions">
      <div className="final-cta__inner">
        <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center', color: '#1B1712' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(15, 118, 110, 0.12)',
              color: '#0F766E',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '16px',
            }}
          >
            <ShieldCheck size={16} />
            Verified Bengaluru Dispatch
          </div>

          <h2 className="final-cta__heading" style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1.25, marginBottom: '16px' }}>
            Breakdown on the road?
            <br />
            We're ready to dispatch.
          </h2>

          <p className="final-cta__sub" style={{ fontSize: '16px', color: '#5B5346', lineHeight: 1.6, marginBottom: '32px' }}>
            Connect with verified mechanics and tow operators in your zone. Transparent service, live status updates, and no subscription required.
          </p>

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
                gap: '8px',
                padding: '14px 32px',
                borderRadius: '9999px',
                backgroundColor: '#0F766E',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '15px',
                textDecoration: 'none',
                boxShadow: '0 6px 20px rgba(15,118,110,0.3)',
                transition: 'all 0.15s ease',
              }}
            >
              <MapPin size={18} />
              Request help
            </Link>

            <Link
              to="/partner/signup"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '14px 32px',
                borderRadius: '9999px',
                backgroundColor: '#FFFFFF',
                color: '#1B1712',
                fontWeight: 700,
                fontSize: '15px',
                border: '1.5px solid #1B1712',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Become a partner
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCta;
