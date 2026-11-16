import React from 'react';

/** The Sahayak mark: a map pin with a cross cut out of it. Same artwork as public/favicon.svg. */
export const LogoMark: React.FC<{ className?: string; title?: string }> = ({
  className = 'w-8 h-8',
  title,
}) => (
  <svg
    viewBox="0 0 64 64"
    className={className}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
  >
    <rect width="64" height="64" rx="16" fill="#111111" />
    <path
      fill="#fff"
      d="M32 11c-9.1 0-16.5 7.1-16.5 15.9 0 11.8 16.5 27.1 16.5 27.1s16.5-15.3 16.5-27.1C48.5 18.1 41.1 11 32 11z"
    />
    <rect x="25.5" y="24.5" width="13" height="5.5" rx="1.6" fill="#111111" />
    <rect x="29.25" y="20.75" width="5.5" height="13" rx="1.6" fill="#111111" />
  </svg>
);

export const Logo: React.FC<{ className?: string; tone?: 'dark' | 'light' }> = ({
  className = '',
  tone = 'dark',
}) => (
  <span className={`inline-flex items-center gap-2 ${className}`}>
    <LogoMark className="w-8 h-8" />
    <span
      className={`text-lg font-bold tracking-tight ${tone === 'light' ? 'text-white' : 'text-ink'}`}
    >
      Sahayak
    </span>
  </span>
);
