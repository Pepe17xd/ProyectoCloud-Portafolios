import React, { useEffect } from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function Modal({ open, title, subtitle, wide = false, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`panel editor-panel modal-dialog ${wide ? 'modal-dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-dialog-title"
      >
        <div className="panelHeading modal-header">
          <div>
            <h2 id="modal-dialog-title">{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button
            type="button"
            className="iconButton modal-close-btn"
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar ventana"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
