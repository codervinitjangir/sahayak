import React from 'react';
import { CheckCircle2, Clock, Navigation, Radio, UserCheck, Wrench } from 'lucide-react';
import { JobStatus } from '../types/jobs';
import { StatusBadge } from './StatusBadge';

export interface JobTimelineProps {
  status: JobStatus;
  /** `compact` is a single rail with the current step named — for dashboard
   *  cards. `full` is the labelled vertical list — for the job page. */
  variant?: 'compact' | 'full';
  /** ISO timestamps per step, where known. Missing ones simply show no time. */
  timestamps?: Partial<Record<JobStatus, string | undefined>>;
  className?: string;
}

interface Step {
  status: JobStatus;
  label: string;
  Icon: typeof Clock;
}

/**
 * Labels are role-neutral: the partner and the owner both read this, and
 * "Partner Assigned" is odd when the partner is looking at their own job.
 */
const STEPS: Step[] = [
  { status: 'requested', label: 'Requested', Icon: Clock },
  { status: 'matching', label: 'Matching', Icon: Radio },
  { status: 'assigned', label: 'Accepted', Icon: UserCheck },
  { status: 'partner_en_route', label: 'En route', Icon: Navigation },
  { status: 'in_progress', label: 'On site', Icon: Wrench },
  { status: 'completed', label: 'Completed', Icon: CheckCircle2 },
];

function formatTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export const JobTimeline: React.FC<JobTimelineProps> = ({
  status,
  variant = 'full',
  timestamps,
  className = '',
}) => {
  // Cancelled and no_match_found leave the happy path entirely; drawing them as
  // a step on the rail would imply the job is still progressing.
  if (status === 'cancelled' || status === 'no_match_found') {
    return (
      <div className={className}>
        <StatusBadge status={status} />
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((step) => step.status === status);
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;

  if (variant === 'compact') {
    const current = STEPS[activeIndex];
    return (
      <div className={className}>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {STEPS.map((step, index) => (
            <span
              key={step.status}
              className={`h-1.5 flex-1 rounded-full ${index <= activeIndex ? 'bg-emerald-500' : 'bg-neutral-200'}`}
            />
          ))}
        </div>
        <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#181818]">
          <current.Icon className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          <span>
            Step {activeIndex + 1} of {STEPS.length} · {current.label}
          </span>
        </p>
      </div>
    );
  }

  return (
    <ol className={`space-y-1 ${className}`}>
      {STEPS.map((step, index) => {
        const isDone = index < activeIndex;
        const isCurrent = index === activeIndex;
        const time = formatTime(timestamps?.[step.status]);

        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isDone
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : isCurrent
                      ? 'bg-white border-[#181818] text-[#181818] ring-1 ring-[#181818]'
                      : 'bg-white border-neutral-200 text-neutral-400'
                }`}
              >
                <step.Icon className="w-4 h-4" aria-hidden="true" />
              </span>
              {index < STEPS.length - 1 && (
                <span className={`w-0.5 flex-1 min-h-[16px] ${isDone ? 'bg-emerald-500' : 'bg-neutral-200'}`} />
              )}
            </div>

            <div className="pb-4 min-w-0">
              <p
                className={`text-sm font-semibold ${
                  isCurrent ? 'text-[#181818]' : isDone ? 'text-neutral-700' : 'text-neutral-400'
                }`}
              >
                {step.label}
                {isCurrent && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-accent">Now</span>
                )}
              </p>
              {time && <p className="text-[11px] text-neutral-500 font-mono">{time}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
