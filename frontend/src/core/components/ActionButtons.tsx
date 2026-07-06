import { ReactNode } from 'react';

export function ActionButtons({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}
