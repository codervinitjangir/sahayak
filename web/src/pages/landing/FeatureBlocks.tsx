import React from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin, Navigation, Wrench, Battery, Truck, Fuel,
  ShieldCheck, ArrowDown, FileText, CheckCircle, FolderOpen, Users
} from 'lucide-react';

export const FeatureBlocks: React.FC = () => {
  return (
    <section id="for-partners" style={{ padding: '32px 24px' }}>
      {/* ── Feature 1: DISPATCH (Blue) ── */}
      <div className="feature-block" style={{ background: 'var(--blue-grad)' }}>
        <div>
          <p className="feature-block__eyebrow" style={{ color: '#0F3B63' }}>
            ON-DEMAND DISPATCH
          </p>
          <h3 className="feature-block__heading" style={{ color: 'var(--blue-heading)' }}>
            Request help. Mechanic dispatched. That simple.
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--blue-deep)' }}>
            Share your location and describe the issue.
            We assign the nearest certified mechanic or tow truck
            and dispatch them to your doorstep — no waiting on hold.
          </p>
          <Link to="/owner/request" className="feature-block__cta">
            Request help →
          </Link>
        </div>

        <div className="feature-block__visual">
          <div className="bento-icon-grid">
            {[
              { bg: '#E8F4FD', icon: <MapPin size={20} color="#28486B" /> },
              { bg: '#DCF2E5', icon: <Navigation size={20} color="#33502A" /> },
              { bg: '#FEF3E2', icon: <Wrench size={20} color="#6B4F0E" /> },
              { bg: '#FDEAE4', icon: <Battery size={20} color="#7A3421" /> },
              { bg: '#FEF3E2', icon: <Truck size={20} color="#6B4F0E" /> },
              { bg: '#E8F4FD', icon: <Fuel size={20} color="#28486B" /> },
              { bg: '#FDEAE4', icon: <ShieldCheck size={20} color="#7A3421" /> },
              { bg: '#DCF2E5', icon: <Users size={20} color="#33502A" /> },
            ].map((cell, i) => (
              <div key={i} className="bento-icon-cell" style={{ background: cell.bg }}>
                {cell.icon}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#5B5346', fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#111111', display: 'inline-block' }} />
            <span>Active roadside dispatch network across Bengaluru</span>
          </div>
        </div>
      </div>

      {/* ── Feature 2: LIVE TRACKING (Sage) ── */}
      <div className="feature-block feature-block--reverse" style={{ background: 'var(--sage-grad)' }}>
        <div>
          <p className="feature-block__eyebrow" style={{ color: '#124220' }}>
            LIVE TRACKING
          </p>
          <h3 className="feature-block__heading" style={{ color: 'var(--sage-heading)' }}>
            Track your mechanic in real time
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--sage-deep)' }}>
            Once dispatched, see your service partner's live location
            on the map. Get accurate status updates from dispatch to completion.
          </p>
          <a href="#how-it-works" className="feature-block__cta">
            See how it works →
          </a>
        </div>

        <div className="feature-block__visual">
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1B1712', marginBottom: 16 }}>
            Live Dispatch Telemetry
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.7)', padding: '12px 16px', borderRadius: 12 }}>
              <MapPin size={18} color="#111111" />
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#1B1712' }}>Breakdown Location Pinpointed</div>
                <div style={{ color: '#5B5346' }}>Precise GPS breakdown coordinates</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.7)', padding: '12px 16px', borderRadius: 12 }}>
              <Navigation size={18} color="#15803D" />
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#1B1712' }}>Partner Dispatched &amp; En Route</div>
                <div style={{ color: '#5B5346' }}>Live turn-by-turn route tracking</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.7)', padding: '12px 16px', borderRadius: 12 }}>
              <ShieldCheck size={18} color="#111111" />
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#1B1712' }}>On-Site Assistance &amp; Completion</div>
                <div style={{ color: '#5B5346' }}>Verified service delivery confirmation</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature 3: FOR PARTNERS (Butter) ── */}
      <div className="feature-block" style={{ background: 'var(--butter-grad)' }}>
        <div>
          <p className="feature-block__eyebrow" style={{ color: '#573B06' }}>
            PARTNER WITH US
          </p>
          <h3 className="feature-block__heading" style={{ color: 'var(--butter-heading)' }}>
            Join our network. Get matched to nearby jobs.
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--butter-deep)' }}>
            If you're a mechanic, tow operator, or fuel delivery provider —
            join our network. Get matched to jobs in your area,
            accept with one tap, and build your customer base.
          </p>
          <Link to="/partner/signup" className="feature-block__cta">
            Become a partner →
          </Link>
        </div>

        <div className="feature-block__visual">
          <div className="upload-card">
            <div className="upload-card__icon">
              <FileText size={20} />
            </div>
            <div>
              <div className="upload-card__text">Partner Operations Console</div>
              <div className="upload-card__sub">Job dispatch alerts &amp; real-time job accept</div>
            </div>
          </div>

          <div className="gen-arrow">
            <ArrowDown size={24} />
          </div>

          <div className="quiz-preview">
            <div className="quiz-preview__title">Partner Capabilities</div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#15803D" />
              <span>Mechanical breakdown and tyre support</span>
            </div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#15803D" />
              <span>Flatbed and towing transport</span>
            </div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#111111" />
              <span>Emergency jumpstart and fuel delivery</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature 4: TRUST (Coral) ── */}
      <div className="feature-block feature-block--reverse" style={{ background: 'var(--coral-grad)' }}>
        <div>
          <p className="feature-block__eyebrow" style={{ color: '#591F11' }}>
            SAFETY &amp; TRUST
          </p>
          <h3 className="feature-block__heading" style={{ color: 'var(--coral-heading)' }}>
            Transparent pricing. Verified partners. Direct support.
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--coral-deep)' }}>
            Every service partner is KYC-verified.
            Final price is confirmed when the job is completed.
          </p>
          <Link to="/owner/request" className="feature-block__cta">
            Request help →
          </Link>
        </div>

        <div className="feature-block__visual">
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#E8F4FD' }}>
              <FolderOpen size={18} color="#28486B" />
            </div>
            <div>
              <div className="folder-item__name">Tier 1 Identity Verification</div>
              <div className="folder-item__sub">Aadhaar, PAN &amp; Driving Licence checks</div>
            </div>
          </div>
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#DCF2E5' }}>
              <FolderOpen size={18} color="#33502A" />
            </div>
            <div>
              <div className="folder-item__name">Vehicle &amp; Equipment Verification</div>
              <div className="folder-item__sub">Tow trucks, mobile repair vans &amp; tools</div>
            </div>
          </div>
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#FDEAE4' }}>
              <FolderOpen size={18} color="#7A3421" />
            </div>
            <div>
              <div className="folder-item__name">Transparent Settlement</div>
              <div className="folder-item__sub">Final price is confirmed when the job is completed</div>
            </div>
          </div>

          <div className="cohort-badges">
            <span className="cohort-badge">🔧 Certified Mechanics</span>
            <span className="cohort-badge">🚛 Verified Tow Operators</span>
            <span className="cohort-badge">⛽ Emergency Fuel Providers</span>
            <span className="cohort-badge">🔋 Battery Specialists</span>
          </div>
        </div>
      </div>
    </section>
  );
};
