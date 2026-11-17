import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, UserRole } from '../../src/app/AuthProvider';
import { RequireRole } from '../../src/app/RouteGuards';

const resolveMock = vi.fn();
vi.mock('../../src/services/supabase', () => ({
  IS_SUPABASE_CONFIGURED: false,
  getSupabase: () => { throw new Error('not configured'); },
  signOut: async () => undefined,
}));
vi.mock('../../src/services/identity.service', async (orig) => ({
  ...(await orig<typeof import('../../src/services/identity.service')>()),
  identityService: { resolve: () => resolveMock() },
}));

const BACKEND_ROLE: Record<UserRole, 'user' | 'partner' | 'admin'> = {
  owner: 'user', partner: 'partner', ops: 'admin', super_admin: 'admin',
};

/**
 * Mounts the guard for `allowedRoles` at /start with the given active role, plus
 * landing pages at each role's home so we can assert where a mismatch lands.
 *
 * Note: this covers routing behaviour only. RequireRole is deliberately not a
 * security boundary — the role it reads is client-side state.
 */
function renderGuard(role: UserRole, allowedRoles: UserRole[]) {
  localStorage.setItem('sahayak_role', role);
  localStorage.setItem('sahayak_token', 'test-token');
  resolveMock.mockResolvedValue({ kind: 'registered', identity: { role: BACKEND_ROLE[role], id: 'id-1' } });

  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route
            path="/start"
            element={
              <RequireRole allowedRoles={allowedRoles}>
                <div>Protected Content</div>
              </RequireRole>
            }
          />
          <Route path="/owner" element={<div>Owner Home</div>} />
          <Route path="/partner" element={<div>Partner Home</div>} />
          <Route path="/admin" element={<div>Admin Home</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('RequireRole', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders children when the active role is allowed', async () => {
    renderGuard('owner', ['owner']);
    expect(await screen.findByText('Protected Content')).toBeInTheDocument();
  });

  it('renders children when the role is one of several allowed', async () => {
    renderGuard('ops', ['ops', 'super_admin']);
    expect(await screen.findByText('Protected Content')).toBeInTheDocument();
  });

  it('sends a partner to the partner home when the route is not theirs', async () => {
    renderGuard('partner', ['owner']);
    expect(await screen.findByText('Partner Home')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('sends ops to the admin console when the route is not theirs', async () => {
    renderGuard('ops', ['owner']);
    expect(await screen.findByText('Admin Home')).toBeInTheDocument();
  });

  it('sends a super_admin to the admin console when the route is not theirs', async () => {
    renderGuard('super_admin', ['partner']);
    expect(await screen.findByText('Admin Home')).toBeInTheDocument();
  });

  it('falls back to the owner home for an owner on a route they cannot access', async () => {
    renderGuard('owner', ['partner']);
    expect(await screen.findByText('Owner Home')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login page', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/start']}>
          <Routes>
            <Route path="/start" element={<RequireRole allowedRoles={['owner']}><div>Protected Content</div></RequireRole>} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    expect(await screen.findByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});
