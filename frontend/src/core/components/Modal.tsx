import { ReactNode } from 'react';

export function Modal({
  title,
  children,
  footer,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal ${className}`.trim()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer modal-footer-sticky">{footer}</div> : null}
      </section>
    </div>
  );
}
