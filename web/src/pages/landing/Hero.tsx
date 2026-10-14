import React from 'react';
import { Link } from 'react-router-dom';
import { RoadStrip, RoadsideScene } from './HeroCollageEnhancements';

export const Hero: React.FC = () => {
  return (
    <section className="hero" id="top">
      {/* Collage Art Background */}
      <div className="hero__collage">
        {/* Dark road with dashed lane markings */}
        <RoadStrip />

        {/* Cohesive car-and-mechanic illustration along the bottom road */}
        <RoadsideScene />
      </div>

      {/* Foreground Content */}
      <div className="hero__content">
        <h1 className="hero__headline">
          Vehicle breakdown?
          <br />
          <em>We come to you.</em>
        </h1>

        <p className="hero__sub">
          On-demand roadside assistance across Bengaluru.
          Certified mechanics and tow trucks at your doorstep —
          transparent pricing, no hidden charges.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <Link to="/owner/request" className="hero__cta">
            Request help
          </Link>
          <Link
            to="/partner/signup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 24px',
              borderRadius: '9999px',
              fontWeight: 600,
              fontSize: '14px',
              border: '1.5px solid #1B1712',
              color: '#1B1712',
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

export default Hero;
