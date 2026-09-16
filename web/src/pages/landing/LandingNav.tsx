import React, { useState, useEffect } from 'react';

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
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>

      <div className="landing-nav__right">
        <a href="/owner" className="landing-nav__login">
          Log in
        </a>
        <a href="/owner/request" className="landing-nav__cta">
          Get Roadside Help
        </a>
      </div>
    </nav>
  );
};
