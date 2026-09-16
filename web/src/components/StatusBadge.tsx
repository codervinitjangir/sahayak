import React from 'react';
import {
  Clock,
  Radio,
  UserCheck,
  Navigation,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { JobStatus } from '../types/jobs';

export interface StatusBadgeProps {
  status: JobStatus;
  className?: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '', size = 'md' }) => {
  const configs: Record<
    JobStatus,
    { label: string; icon: React.ComponentType<{ className?: string }>; classes: string }
  > = {
    requested: {
      label: 'Requested',
      icon: Clock,
      classes: 'bg-slate-100 text-slate-700 border-slate-300',
    },
    matching: {
      label: 'Matching Partner',
      icon: Radio,
      classes: 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse',
    },
    assigned: {
      label: 'Partner Assigned',
      icon: UserCheck,
      classes: 'bg-teal-50 text-brand-800 border-teal-300',
    },
    partner_en_route: {
      label: 'En Route',
      icon: Navigation,
      classes: 'bg-sky-50 text-sky-800 border-sky-300',
    },
    in_progress: {
      label: 'In Progress',
      icon: Wrench,
      classes: 'bg-teal-50 text-brand-800 border-teal-300',
    },
    completed: {
      label: 'Completed',
      icon: CheckCircle2,
      classes: 'bg-green-50 text-green-800 border-green-300',
    },
    cancelled: {
      label: 'Cancelled',
      icon: XCircle,
      classes: 'bg-red-50 text-red-800 border-red-300',
    },
    no_match_found: {
      label: 'Operator Intervening',
      icon: AlertTriangle,
      classes: 'bg-amber-100 text-amber-900 border-amber-400',
    },
  };

  const current = configs[status] || {
    label: status,
    icon: Clock,
    classes: 'bg-slate-100 text-slate-700 border-slate-300',
  };

  const Icon = current.icon;
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-3 py-1 text-sm gap-1.5 font-medium';

  return (
    <span
      role="status"
      className={`inline-flex items-center rounded-full border ${sizeClasses} ${current.classes} ${className}`}
    >
      <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
      <span>{current.label}</span>
    </span>
  );
};
