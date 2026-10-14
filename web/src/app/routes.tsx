import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { OwnerHome } from '../pages/owner/OwnerHome';
import { RequestHelpPage } from '../pages/owner/RequestHelpPage';
import { JobTrackingPage } from '../pages/owner/JobTrackingPage';
import { RequireRole } from './RouteGuards';

import { LandingPage } from '../pages/landing/LandingPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { OwnerSignup } from '../pages/owner/OwnerSignup';
import { PartnerSignup } from '../pages/partner/PartnerSignup';
import { PartnerConsole } from '../pages/partner/PartnerConsole';
import { OffersPage } from '../pages/partner/OffersPage';
import { ActiveJobPage } from '../pages/partner/ActiveJobPage';
import { AdminConsole } from '../pages/admin/AdminConsole';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<Navigate to="/owner/signup" replace />} />
      <Route path="/owner/signup" element={<OwnerSignup />} />
      <Route path="/owner/request" element={<RequestHelpPage />} />

      {/* Owner Role Routes */}
      <Route element={<RequireRole allowedRoles={['owner', 'ops', 'super_admin']} />}>
        <Route path="/owner" element={<OwnerHome />} />
        <Route path="/owner/jobs/:jobId" element={<JobTrackingPage />} />
      </Route>

      {/* Partner Routes — every concrete path must precede the /partner/* catch-all.
          The four console destinations all render the same shell; the path only
          decides which view it opens on, and switching views after that is a
          state change, not a navigation. */}
      <Route path="/partner/signup" element={<PartnerSignup />} />
      <Route path="/partner/dashboard" element={<PartnerConsole />} />
      <Route path="/partner/offers" element={<OffersPage />} />
      <Route path="/partner/jobs/:jobId" element={<ActiveJobPage />} />
      <Route path="/partner/verification" element={<PartnerConsole />} />
      <Route path="/partner/preferences" element={<PartnerConsole />} />
      <Route path="/partner/settings" element={<PartnerConsole />} />
      <Route path="/partner" element={<Navigate to="/partner/dashboard" replace />} />
      <Route path="/partner/*" element={<Navigate to="/partner/dashboard" replace />} />

      {/* Ops console over the three admin analytics endpoints.
          Not wrapped in RequireRole: that guard reads client-side role state and
          would bounce an admin whose local role has not been set yet, while
          protecting nothing — `require_admin` on each endpoint is the real
          boundary, and AdminConsole renders its 403 explicitly. */}
      <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
      <Route path="/admin/:tab" element={<AdminConsole />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/owner" replace />} />
    </Routes>
  );
};
