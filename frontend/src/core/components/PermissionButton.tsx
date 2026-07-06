import { ButtonHTMLAttributes, ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

export function PermissionButton({
  permission,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return null;
  return <button {...props}>{children}</button>;
}
