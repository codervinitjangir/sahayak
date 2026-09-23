import React, { HTMLAttributes } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Semantic tag. Default `section` — most cards are a labelled region. */
  as?: 'div' | 'section' | 'article';
  /** 16px, 24px, or none for cards that manage their own inner padding. */
  padding?: 'none' | 'sm' | 'md';
}

const PADDING: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
};

/**
 * The plain surface every partner console panel sits on.
 *
 * Flat white on a slate border — no gradient, no shadow stack. The page gets
 * its rhythm from spacing between cards, not from decoration on them.
 */
export const Card: React.FC<CardProps> = ({
  as = 'section',
  padding = 'sm',
  className = '',
  children,
  ...props
}) => {
  const Tag = as;
  return (
    <Tag className={`bg-surface border border-slate-200 rounded-2xl ${PADDING[padding]} ${className}`} {...props}>
      {children}
    </Tag>
  );
};

export interface CardHeaderProps {
  title: string;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  /** Rendered at the right edge — a link, a toggle, a count. */
  action?: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, eyebrow, action, className = '' }) => (
  <div className={`flex items-start justify-between gap-4 ${className}`}>
    <div className="min-w-0">
      {eyebrow && (
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{eyebrow}</p>
      )}
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
