import React from 'react';
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
          <a href="#features" className="feature-block__cta">
            See how it works →
          </a>
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
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <div style={{
              flex: 1, height: 8, borderRadius: 4,
              background: 'linear-gradient(90deg, #0F766E 72%, #E4DBC8 72%)',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#5B5346', fontWeight: 600 }}>
            <span>72% partners active now</span>
            <span>Bengaluru</span>
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
            on the map. Get accurate ETAs and instant status updates
            — from "en route" to "job complete".
          </p>
          <a href="#features" className="feature-block__cta">
            See how it works →
          </a>
        </div>

        <div className="feature-block__visual">
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1B1712', marginBottom: 12 }}>
            Avg. Response Time by Zone
          </div>
          <div className="decay-graph">
            {[
              { height: '85%', bg: '#0F766E', label: 'Indiranagar' },
              { height: '72%', bg: '#15803D', label: 'HSR' },
              { height: '48%', bg: '#B45309', label: 'Whitefield' },
              { height: '28%', bg: '#B91C1C', label: 'E-City' },
            ].map((bar, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="decay-graph__bar" style={{ height: bar.height, background: bar.bg }} />
                <div className="decay-graph__label">{bar.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#5B5346' }}>
            Avg. response under 15 min across all zones
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
            Earn more. Get matched to nearby jobs.
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--butter-deep)' }}>
            If you're a mechanic, tow operator, or fuel delivery provider —
            join our network. Get auto-matched to jobs near you,
            accept with one tap, and grow your business.
          </p>
          <a href="#features" className="feature-block__cta">
            Become a partner →
          </a>
        </div>

        <div className="feature-block__visual">
          <div className="upload-card">
            <div className="upload-card__icon">
              <FileText size={20} />
            </div>
            <div>
              <div className="upload-card__text">Today's Earnings Summary</div>
              <div className="upload-card__sub">12 jobs completed · ₹8,400 earned</div>
            </div>
          </div>

          <div className="gen-arrow">
            <ArrowDown size={24} />
          </div>

          <div className="quiz-preview">
            <div className="quiz-preview__title">Active Service Zones</div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#15803D" />
              <span>Indiranagar: 8 mechanics, 3 tow trucks</span>
            </div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#15803D" />
              <span>Koramangala: 6 mechanics, 4 fuel vans</span>
            </div>
            <div className="quiz-preview__item">
              <CheckCircle size={14} color="#B45309" />
              <span>Whitefield: Hiring mechanics now</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature 4: TRUST (Coral) ── */}
      <div className="feature-block feature-block--reverse" style={{ background: 'var(--coral-grad)' }}>
        <div>
          <p className="feature-block__eyebrow" style={{ color: '#591F11' }}>
            SAFETY & TRUST
          </p>
          <h3 className="feature-block__heading" style={{ color: 'var(--coral-heading)' }}>
            Transparent pricing. Verified partners. Warranty on every job.
          </h3>
          <p className="feature-block__body" style={{ color: 'var(--coral-deep)' }}>
            Every service partner is KYC-verified and rated by real customers.
            You see the price before you confirm — no surprises, no haggling.
            All repairs carry a 30-day service warranty.
          </p>
          <a href="#features" className="feature-block__cta">
            Our trust promise →
          </a>
        </div>

        <div className="feature-block__visual">
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#E8F4FD' }}>
              <FolderOpen size={18} color="#28486B" />
            </div>
            <div>
              <div className="folder-item__name">Indiranagar & Domlur</div>
              <div className="folder-item__sub">14 verified partners · 238 jobs this month</div>
            </div>
          </div>
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#DCF2E5' }}>
              <FolderOpen size={18} color="#33502A" />
            </div>
            <div>
              <div className="folder-item__name">Koramangala & HSR Layout</div>
              <div className="folder-item__sub">11 verified partners · 194 jobs this month</div>
            </div>
          </div>
          <div className="folder-item">
            <div className="folder-item__icon" style={{ background: '#FDEAE4' }}>
              <FolderOpen size={18} color="#7A3421" />
            </div>
            <div>
              <div className="folder-item__name">Whitefield & Mahadevapura</div>
              <div className="folder-item__sub">6 verified partners · 87 jobs this month</div>
            </div>
          </div>

          <div className="cohort-badges">
            <span className="cohort-badge">🔧 Mechanics (32)</span>
            <span className="cohort-badge">🚛 Tow Trucks (12)</span>
            <span className="cohort-badge">⛽ Fuel Delivery (8)</span>
            <span className="cohort-badge">🔋 Battery Service (6)</span>
          </div>
        </div>
      </div>
    </section>
  );
};
