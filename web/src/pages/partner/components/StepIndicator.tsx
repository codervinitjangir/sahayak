import React from 'react';
import { Check } from 'lucide-react';

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
  completedSteps?: number[];
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <div className="step-indicator" role="navigation" aria-label="Signup progress">
      {steps.map((label, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <div
                className={`step-indicator__line ${isCompleted ? 'step-indicator__line--done' : ''}`}
                aria-hidden="true"
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`step-indicator__dot ${
                  isCompleted
                    ? 'step-indicator__dot--done'
                    : isCurrent
                    ? 'step-indicator__dot--active'
                    : 'step-indicator__dot--upcoming'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
                title={label}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <span className="text-xs font-semibold">{i + 1}</span>
                )}
              </div>
              <span
                className={`hidden md:inline-block text-xs font-semibold ${
                  isCurrent
                    ? 'text-brand-800 font-bold'
                    : isCompleted
                    ? 'text-slate-700'
                    : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default StepIndicator;
