import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { OwnerHome } from '../pages/owner/OwnerHome';
import { RequestHelpPage } from '../pages/owner/RequestHelpPage';
import { JobTrackingPage } from '../pages/owner/JobTrackingPage';
import { RequireRole } from './RouteGuards';

import { LandingPage } from '../pages/landing/LandingPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { TermsPage, PrivacyPage } from '../pages/legal/LegalPage';
import { OwnerSignup } from '../pages/owner/OwnerSignup';
import { PublicTrackPage } from '../pages/public/PublicTrackPage';
const PartnerSignup = lazy(() => import('../pages/partner/PartnerSignup').then((m) => ({ default: m.PartnerSignup })));
const PartnerConsole = lazy(() => import('../pages/partner/PartnerConsole').then((m) => ({ default: m.PartnerConsole })));
const OffersPage = lazy(() => import('../pages/partner/OffersPage').then((m) => ({ default: m.OffersPage })));
const ActiveJobPage = lazy(() => import('../pages/partner/ActiveJobPage').then((m) => ({ default: m.ActiveJobPage })));
const AdminConsole = lazy(() => import('../pages/admin/AdminConsole').then((m) => ({ default: m.AdminConsole })));

const RouteFallback: React.FC = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-ink-soft" role="status" aria-live="polite">
    Loading…
  </div>
);

export const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/track/:jobId" element={<PublicTrackPage />} />
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

      {/* Ops console & partner verification queue */}
      <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
      <Route path="/admin/verify" element={<Navigate to="/admin/partners" replace />} />
      {/* UX gate only: the data is protected server-side (401/403 on every
          /admin/analytics call). This stops the console shell rendering for a
          visitor who is not signed in as ops. */}
      <Route element={<RequireRole allowedRoles={['ops', 'super_admin']} />}>
        <Route path="/admin/:tab" element={<AdminConsole />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/owner" replace />} />
    </Routes>
    </Suspense>
  );
};
