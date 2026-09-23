import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface NavItem {
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'For Partners', href: '#for-partners' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Track Job', href: '/owner' },
];

// NAV_ITEMS mixes in-page anchors with app routes. Anchors must stay raw <a> so
// the browser handles the scroll; routes go through Link so they don't full-reload.
const isAnchor = (href: string) => href.startsWith('#');

export const LandingNav: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handle, { passive: true });
    return () => window.removeEventListener('scroll', handle);
  }, []);

  return (
    <nav
      className="landing-nav"
      style={{
        background: scrolled ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.65)',
        boxShadow: scrolled
          ? '0 12px 24px 2px rgba(0,0,0,0.08)'
          : '0 12px 24px 2px rgba(0,0,0,0.05)',
      }}
    >
      <a href="#top" className="landing-nav__logo">
        Sahayak
      </a>

      <ul className="landing-nav__links">
        {NAV_ITEMS.map((item) => (
          <li key={item.label}>
            {isAnchor(item.href) ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <Link to={item.href}>{item.label}</Link>
            )}
          </li>
        ))}
      </ul>

      <div className="landing-nav__right">
        <Link to="/login" className="landing-nav__login">
          Log in
        </Link>
        <Link to="/owner/request" className="landing-nav__cta">
          Get Roadside Help
        </Link>
      </div>
    </nav>
  );
};
