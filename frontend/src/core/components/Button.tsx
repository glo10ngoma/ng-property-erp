import { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <button className={className} {...props}>{children}</button>;
}
