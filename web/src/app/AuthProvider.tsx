import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole = 'owner' | 'partner' | 'ops' | 'super_admin';

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
}

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole;
  setRole: (role: UserRole) => void;
  token: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to 'owner' for demo & development convenience
  const [role, setRoleState] = useState<UserRole>(() => {
    return (localStorage.getItem('sahayak_role') as UserRole) || 'owner';
  });

  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sahayak_token') || 'demo-jwt-token-owner';
  });

  const [user, setUser] = useState<UserProfile | null>({
    id: 'usr_owner_01',
    name: 'Asha Sharma',
    phone: '+91 98765 43210',
    email: 'asha@example.com',
    role: 'owner',
  });

  const setRole = (newRole: UserRole) => {
    setRoleState(newRole);
    localStorage.setItem('sahayak_role', newRole);
    if (newRole === 'partner') {
      setUser({
        id: 'ptr_ramesh_01',
        name: 'Ramesh Kumar (Speedy Mechanics)',
        phone: '+91 98111 22334',
        role: 'partner',
      });
    } else if (newRole === 'ops' || newRole === 'super_admin') {
      setUser({
        id: 'adm_ops_01',
        name: 'Sahayak Ops Console',
        phone: '+91 98000 11223',
        email: 'ops@sahayak.in',
        role: newRole,
      });
    } else {
      setUser({
        id: 'usr_owner_01',
        name: 'Asha Sharma',
        phone: '+91 98765 43210',
        email: 'asha@example.com',
        role: 'owner',
      });
    }
  };

  useEffect(() => {
    localStorage.setItem('sahayak_role', role);
    if (token) localStorage.setItem('sahayak_token', token);
  }, [role, token]);

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('sahayak_token');
  };

  return (
    <AuthContext.Provider value={{ user, role, setRole, token, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
