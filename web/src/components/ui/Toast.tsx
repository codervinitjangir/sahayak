import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastProps {
  id?: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  onClose?: () => void;
  durationMs?: number;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  type = 'info',
  title,
  message,
  onClose,
  durationMs = 5000,
  className = '',
}) => {
  useEffect(() => {
    if (durationMs > 0 && onClose) {
      const timer = setTimeout(onClose, durationMs);
      return () => clearTimeout(timer);
    }
  }, [durationMs, onClose]);

  const config = {
    success: {
      icon: CheckCircle2,
      style: 'border-green-200 bg-green-50 text-green-900',
      iconStyle: 'text-green-600',
    },
    error: {
      icon: AlertCircle,
      style: 'border-emergency-200 bg-emergency-50 text-emergency-900',
      iconStyle: 'text-emergency-600',
    },
    warning: {
      icon: AlertTriangle,
      style: 'border-amber-200 bg-amber-50 text-amber-900',
      iconStyle: 'text-amber-600',
    },
    info: {
      icon: Info,
      style: 'border-brand-200 bg-brand-50 text-brand-900',
      iconStyle: 'text-brand-700',
    },
  }[type];

  const Icon = config.icon;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-4 rounded-xl border shadow-warm-sm transition-all duration-200 animate-in slide-in-from-top-2 ${config.style} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${config.iconStyle}`} />

      <div className="flex-1 min-w-0">
        {title && <h5 className="text-xs font-bold leading-tight">{title}</h5>}
        <p className="text-xs font-medium mt-0.5 leading-relaxed">{message}</p>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-1 -mr-1 -mt-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-black/5 transition-colors"
          aria-label="Dismiss toast"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
