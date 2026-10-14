import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message: string;
  code?: string;
  requestId?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message,
  code,
  requestId,
  onRetry,
  className = '',
}) => {
  return (
    <div
      role="alert"
      className={`p-6 rounded-2xl border border-emergency-200 bg-emergency-50/50 text-ink space-y-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-emergency-100 text-emergency-700 shrink-0">
          <AlertCircle className="w-5 h-5" />
        </div>

        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-emergency-900">{title}</h4>
            {code && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emergency-200/60 text-emergency-900 font-semibold">
                {code}
              </span>
            )}
          </div>
          <p className="text-xs text-emergency-800 leading-relaxed">{message}</p>

          {requestId && (
            <p className="text-[10px] font-mono text-ink-muted">
              Request ID: {requestId}
            </p>
          )}
        </div>
      </div>

      {onRetry && (
        <div className="pt-1 pl-11">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="!border-emergency-300 text-emergency-800 hover:bg-emergency-100"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </Button>
        </div>
      )}
    </div>
  );
};
