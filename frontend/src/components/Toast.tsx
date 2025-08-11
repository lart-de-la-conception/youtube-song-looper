"use client";
import React from 'react';

export type ToastItem = {
  id: number;
  type: 'success' | 'error';
  text: string;
};

type ToastProps = {
  toasts: ToastItem[];
  onClose?: (id: number) => void;
  position?: 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left';
};

const positionClass: Record<NonNullable<ToastProps['position']>, string> = {
  'bottom-right': 'bottom-4 right-4',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-left': 'top-4 left-4',
};

export default function Toast({ toasts, onClose, position = 'bottom-right' }: ToastProps) {
  return (
    <div className={`pointer-events-none fixed z-50 flex flex-col gap-3 ${positionClass[position]}`}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={
            // Neutral black theme, consistent sizing and spacing
            'pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm '+
            'bg-black text-white shadow-lg ring-1 ring-black/10 animate-toast-in'
          }
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex h-4 w-4 items-center justify-center select-none">
            {t.type === 'success' ? '✓' : '!'}
          </span>
          <span className="leading-snug">{t.text}</span>
          {onClose && (
            <button
              aria-label="Dismiss"
              onClick={() => onClose(t.id)}
              className="ml-auto -mr-1 rounded p-1 hover:bg-white/10"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
