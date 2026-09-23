import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, UserRole } from './AuthProvider';

interface RequireRoleProps {
  allowedRoles: UserRole[];
  children?: React.ReactNode;
}

/**
 * UX routing only — NOT a security boundary.
 *
 * The role this reads is client-side state the user can set from the navbar
 * switcher (and edit in localStorage). It decides which screen makes sense to
 * show, nothing more. Every authorization decision must be enforced server-side
 * on the request itself; assume any route here is reachable by any user.
 */
export const RequireRole: React.FC<RequireRoleProps> = ({ allowedRoles, children }) => {
  const { role } = useAuth();

  if (!allowedRoles.includes(role)) {
    // If user role doesn't match, redirect to corresponding role home
    if (role === 'partner') return <Navigate to="/partner" replace />;
    if (role === 'ops' || role === 'super_admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/owner" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};
