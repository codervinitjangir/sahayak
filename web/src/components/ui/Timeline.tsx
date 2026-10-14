import React from 'react';

export interface TimelineItem {
  id?: string;
  title: string;
  description?: string;
  timestamp?: string;
  status?: 'complete' | 'active' | 'pending' | 'danger';
  icon?: React.ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

export const Timeline: React.FC<TimelineProps> = ({ items, className = '' }) => {
  return (
    <div className={`space-y-4 ${className}`}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const statusColors = {
          complete: 'bg-brand-700 text-white ring-4 ring-brand-100',
          active: 'bg-amber-500 text-white ring-4 ring-amber-100 animate-pulse',
          pending: 'bg-paper-card text-ink-muted border border-line-subtle',
          danger: 'bg-emergency-600 text-white ring-4 ring-emergency-100',
        };

        const itemStatus = item.status || 'pending';

        return (
          <div key={item.id || index} className="relative flex items-start gap-3">
            {!isLast && (
              <span
                className="absolute left-3.5 top-7 bottom-0 w-0.5 -ml-px bg-line-subtle"
                aria-hidden="true"
              />
            )}

            <div
              className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${statusColors[itemStatus]}`}
            >
              {item.icon || index + 1}
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-ink">{item.title}</p>
                {item.timestamp && (
                  <time className="text-[10px] font-mono text-ink-muted shrink-0">
                    {item.timestamp}
                  </time>
                )}
              </div>
              {item.description && (
                <p className="mt-0.5 text-xs text-ink-soft leading-normal">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
