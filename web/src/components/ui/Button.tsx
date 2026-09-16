import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', isLoading = false, disabled, className = '', ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed touch-target';

    const sizeStyles = {
      sm: 'text-sm px-3 py-1.5 gap-1.5',
      md: 'text-base px-4 py-2.5 gap-2 min-h-[44px]',
      lg: 'text-lg px-6 py-3.5 gap-2.5 min-h-[50px]',
    };

    const variantStyles = {
      primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-700',
      danger: 'bg-emergency-700 text-white hover:bg-emergency-800 active:bg-red-900 focus-visible:ring-emergency-700',
      secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-400',
      outline:
        'border-2 border-brand-700 text-brand-700 bg-transparent hover:bg-brand-50 active:bg-brand-100 focus-visible:ring-brand-700',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
