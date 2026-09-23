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

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<Navigate to="/owner/signup" replace />} />
      <Route path="/owner/signup" element={<OwnerSignup />} />

      {/* Owner Role Routes */}
      <Route element={<RequireRole allowedRoles={['owner', 'ops', 'super_admin']} />}>
        <Route path="/owner" element={<OwnerHome />} />
        <Route path="/owner/request" element={<RequestHelpPage />} />
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

      {/* Admin placeholder */}
      <Route
        path="/admin/*"
        element={
          <div className="p-8 text-center">
            <h2 className="text-xl font-bold">Admin Portal</h2>
            <p className="text-sm text-slate-500">Admin interface will be built in the next pass.</p>
          </div>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/owner" replace />} />
    </Routes>
  );
};
