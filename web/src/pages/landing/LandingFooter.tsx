import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Globe } from 'lucide-react';

export const LandingFooter: React.FC = () => {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubscribed(true);
    }
  };

  return (
    <footer className="landing-footer">
      <div className="landing-footer__statement">
        <span className="landing-footer__eyebrow">BENGALURU ROAD RESCUE NETWORK</span>
        <h3 className="landing-footer__headline">
          Keeping Bengaluru moving safely.{' '}
          <span className="landing-footer__accent">Rain or shine, day or night.</span>
        </h3>
        <p className="landing-footer__subtext">
          Subscribe to citywide road safety alerts, monsoon breakdown tips, and network coverage updates.
        </p>
      </div>

      <form className="landing-footer__newsletter" onSubmit={handleSubscribe}>
        <input
          type="email"
          className="landing-footer__newsletter-input"
          placeholder="ENTER YOUR EMAIL FOR SAFETY ADVISORIES"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="Email for safety advisories"
        />
        <button type="submit" className="landing-footer__newsletter-btn">
          {subscribed ? 'Subscribed!' : 'Subscribe'}
        </button>
      </form>

      <div className="landing-footer__columns">
        <div>
          <h4 className="landing-footer__col-title">Product</h4>
          <ul className="landing-footer__col-links">
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#features">Dispatch Engine</a></li>
            <li><a href="#pricing">Fleet Pricing</a></li>
            <li><Link to="/owner">Owner Portal</Link></li>
            <li><Link to="/owner/request">Request Help</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="landing-footer__col-title">Services</h4>
          <ul className="landing-footer__col-links">
            <li><Link to="/owner/request">Puncture Repair</Link></li>
            <li><Link to="/owner/request">Battery Jumpstart</Link></li>
            <li><Link to="/owner/request">Flatbed Towing</Link></li>
            <li><Link to="/owner/request">Emergency Fuel</Link></li>
            <li><Link to="/owner/request">Mechanical Triage</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="landing-footer__col-title">Partners</h4>
          <ul className="landing-footer__col-links">
            <li><Link to="/partner">Partner Portal</Link></li>
            <li><Link to="/partner">Mechanic Signup</Link></li>
            <li><Link to="/partner">Tow Operators</Link></li>
            <li><Link to="/partner">Coverage Zones</Link></li>
            <li><Link to="/partner">Verification FAQ</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="landing-footer__col-title">Safety &amp; Trust</h4>
          <ul className="landing-footer__col-links">
            <li><a href="#features">Verified Partners</a></li>
            <li><a href="#features">Fixed Rate Card</a></li>
            <li><a href="#features">GPS Live Tracking</a></li>
            <li><a href="#features">Emergency SOP</a></li>
            <li><a href="#features">Escalation Desk</a></li>
          </ul>
        </div>

        <div>
          <h4 className="landing-footer__col-title">Sahayak</h4>
          <ul className="landing-footer__col-links">
            <li><a href="#top">About Us</a></li>
            <li><a href="#top">Bengaluru Network</a></li>
            <li><a href="#top">Careers</a></li>
            <li><a href="#top">Privacy Policy</a></li>
            <li><a href="#top">Terms of Service</a></li>
          </ul>
        </div>
      </div>

      <div className="landing-footer__badges">
        <div className="landing-footer__badge">
          <span className="landing-footer__badge-label">24 / 7<br />LIVE</span>
        </div>
        <div className="landing-footer__badge">
          <span className="landing-footer__badge-label">BLR<br />ZONES</span>
        </div>
        <div className="landing-footer__badge">
          <span className="landing-footer__badge-label">KYC<br />VERIFIED</span>
        </div>
        <div className="landing-footer__badge">
          <span className="landing-footer__badge-label">FIXED<br />RATES</span>
        </div>
      </div>

      <div className="landing-footer__bottom">
        <div className="landing-footer__copyright">
          © 2026 SAHAYAK ROAD RESCUE TECH PVT LTD. BENGALURU, INDIA.
        </div>

        <div className="landing-footer__bottom-controls">
          <div className="theme-switcher">
            <button
              type="button"
              className={`theme-switcher__btn ${theme === 'light' ? 'theme-switcher__btn--active' : ''}`}
              onClick={() => setTheme('light')}
              aria-label="Light theme"
              aria-pressed={theme === 'light'}
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              className={`theme-switcher__btn ${theme === 'dark' ? 'theme-switcher__btn--active' : ''}`}
              onClick={() => setTheme('dark')}
              aria-label="Dark theme"
              aria-pressed={theme === 'dark'}
            >
              <Moon size={14} />
            </button>
          </div>

          <button type="button" className="lang-btn">
            <Globe size={13} />
            <span>English (IN)</span>
          </button>
        </div>
      </div>
    </footer>
  );
};
