import React from 'react';
import { JobStatus, AssignmentStatus } from '../../types/jobs';
import { Badge } from './Badge';

export interface StatusPillProps {
  status: JobStatus | AssignmentStatus | string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  // Job statuses
  scheduled: { label: 'Booked', variant: 'default' },
  requested: { label: 'Requested', variant: 'warning' },
  matching: { label: 'Finding Partner', variant: 'warning' },
  assigned: { label: 'Partner Assigned', variant: 'default' },
  partner_en_route: { label: 'Partner En Route', variant: 'brand' },
  in_progress: { label: 'In Progress', variant: 'brand' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  no_match_found: { label: 'No Partner Available', variant: 'neutral' },

  // Assignment statuses
  offered: { label: 'Incoming Offer', variant: 'warning' },
  accepted: { label: 'Accepted', variant: 'brand' },
  rejected: { label: 'Declined', variant: 'neutral' },
  timed_out: { label: 'Expired', variant: 'neutral' },
};

export const StatusPill: React.FC<StatusPillProps> = ({ status, size = 'sm', className = '' }) => {
  const config = STATUS_CONFIG[status] || {
    label: status.replace(/_/g, ' '),
    variant: 'neutral' as const,
  };

  return (
    <Badge variant={config.variant} size={size} className={className}>
      {status === 'matching' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" aria-hidden="true" />
      )}
      {status === 'partner_en_route' && (
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-pulse" aria-hidden="true" />
      )}
      <span>{config.label}</span>
    </Badge>
  );
};
