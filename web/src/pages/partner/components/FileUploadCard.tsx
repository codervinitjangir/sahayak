import React, { useRef } from 'react';
import { Upload, FileText, X } from 'lucide-react';

interface FileUploadCardProps {
  label: string;
  fileName?: string;
  onFileSelect: (file: File) => void;
  onRemove?: () => void;
  disabled?: boolean;
  accept?: string;
}

export const FileUploadCard: React.FC<FileUploadCardProps> = ({
  label,
  fileName,
  onFileSelect,
  onRemove,
  disabled = false,
  accept = 'image/*,.pdf',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      // Reset so the same file can be re-selected if removed
      e.target.value = '';
    }
  };

  return (
    <div className={`file-upload-card ${fileName ? 'file-upload-card--has-file' : ''} ${disabled ? 'file-upload-card--disabled' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        aria-label={`Upload ${label}`}
        disabled={disabled}
      />

      <div className="file-upload-card__info">
        <div className="file-upload-card__icon">
          {fileName ? (
            <FileText className="w-5 h-5 text-brand-700" aria-hidden="true" />
          ) : (
            <Upload className="w-5 h-5 text-slate-400" aria-hidden="true" />
          )}
        </div>
        <div className="file-upload-card__text">
          <span className="file-upload-card__label">{label}</span>
          {fileName && (
            <span className="file-upload-card__filename">{fileName}</span>
          )}
        </div>
      </div>

      <div className="file-upload-card__actions">
        {fileName && onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="file-upload-card__remove"
            aria-label={`Remove ${label}`}
            disabled={disabled}
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleClick}
            className="file-upload-card__pick"
            disabled={disabled}
          >
            Choose file
          </button>
        )}
      </div>
    </div>
  );
};
