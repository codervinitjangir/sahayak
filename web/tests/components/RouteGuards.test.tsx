import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, UserRole } from '../../src/app/AuthProvider';
import { RequireRole } from '../../src/app/RouteGuards';

/**
 * Mounts the guard for `allowedRoles` at /start with the given active role, plus
 * landing pages at each role's home so we can assert where a mismatch lands.
 *
 * Note: this covers routing behaviour only. RequireRole is deliberately not a
 * security boundary — the role it reads is client-side state.
 */
function renderGuard(role: UserRole, allowedRoles: UserRole[]) {
  localStorage.setItem('sahayak_role', role);

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
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('RequireRole', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders children when the active role is allowed', () => {
    renderGuard('owner', ['owner']);
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders children when the role is one of several allowed', () => {
    renderGuard('ops', ['ops', 'super_admin']);
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('sends a partner to the partner home when the route is not theirs', () => {
    renderGuard('partner', ['owner']);
    expect(screen.getByText('Partner Home')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('sends ops to the admin console when the route is not theirs', () => {
    renderGuard('ops', ['owner']);
    expect(screen.getByText('Admin Home')).toBeInTheDocument();
  });

  it('sends a super_admin to the admin console when the route is not theirs', () => {
    renderGuard('super_admin', ['partner']);
    expect(screen.getByText('Admin Home')).toBeInTheDocument();
  });

  it('falls back to the owner home for an owner on a route they cannot access', () => {
    renderGuard('owner', ['partner']);
    expect(screen.getByText('Owner Home')).toBeInTheDocument();
  });
});
