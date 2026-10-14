import React, { useState } from 'react';
import { Star } from 'lucide-react';

export interface StarRatingProps {
  value?: number;
  max?: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  scoreText?: string;
  className?: string;
}

export const StarRating: React.FC<StarRatingProps> = ({
  value = 0,
  max = 5,
  onChange,
  readOnly = false,
  size = 'md',
  showScore = false,
  scoreText,
  className = '',
}) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const starSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-5 h-5',
    lg: 'w-7 h-7',
  };

  const displayedValue = hoverValue !== null ? hoverValue : value;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: max }, (_, i) => {
          const starNumber = i + 1;
          const isFilled = starNumber <= displayedValue;

          if (readOnly) {
            return (
              <Star
                key={i}
                className={`${starSizes[size]} ${
                  isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
                }`}
                aria-hidden="true"
              />
            );
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange?.(starNumber)}
              onMouseEnter={() => setHoverValue(starNumber)}
              onMouseLeave={() => setHoverValue(null)}
              className="p-1 rounded hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
              aria-label={`${starNumber} of ${max} stars`}
            >
              <Star
                className={`${starSizes[size]} transition-colors ${
                  isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-200 hover:text-amber-200'
                }`}
              />
            </button>
          );
        })}
      </div>

      {showScore && (
        <span className="text-xs font-bold text-ink tabular-nums ml-1">
          {scoreText || value.toFixed(1)}
        </span>
      )}
    </div>
  );
};
