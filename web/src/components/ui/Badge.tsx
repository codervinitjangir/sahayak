import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'outline';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}) => {
  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 font-bold uppercase tracking-wider',
    md: 'text-xs px-2.5 py-1 font-semibold',
  };

  const variantStyles = {
    default: 'bg-brand-50 text-brand-800 border border-brand-200',
    brand: 'bg-brand-700 text-white',
    success: 'bg-green-50 text-status-success border border-green-200',
    warning: 'bg-amber-50 text-status-warning border border-amber-200',
    danger: 'bg-emergency-50 text-emergency-700 border border-emergency-200',
    neutral: 'bg-paper-card text-ink-soft border border-line-subtle',
    outline: 'border border-line text-ink-soft bg-transparent',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};
