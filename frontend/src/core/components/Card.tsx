import { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <article className={className || 'chart-card'}>{children}</article>;
}
