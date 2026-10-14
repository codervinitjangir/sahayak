import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-dashed border-line bg-paper-card text-ink ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-white shadow-xs border border-line-subtle flex items-center justify-center text-ink-muted mb-3.5">
        <Icon className="w-6 h-6 stroke-[1.5]" />
      </div>

      <h3 className="text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 text-xs text-ink-soft max-w-sm leading-relaxed">{description}</p>

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
