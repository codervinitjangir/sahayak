import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, UserRole } from './AuthProvider';

interface RequireRoleProps {
  allowedRoles: UserRole[];
  children?: React.ReactNode;
}

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
