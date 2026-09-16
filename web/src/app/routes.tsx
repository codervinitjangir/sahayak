import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { OwnerHome } from '../pages/owner/OwnerHome';
import { RequestHelpPage } from '../pages/owner/RequestHelpPage';
import { JobTrackingPage } from '../pages/owner/JobTrackingPage';
import { RequireRole } from './RouteGuards';

import { LandingPage } from '../pages/landing/LandingPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Root renders the Landing Page */}
      <Route path="/" element={<LandingPage />} />

      {/* Owner Role Routes */}
      <Route element={<RequireRole allowedRoles={['owner', 'ops', 'super_admin']} />}>
        <Route path="/owner" element={<OwnerHome />} />
        <Route path="/owner/request" element={<RequestHelpPage />} />
        <Route path="/owner/jobs/:jobId" element={<JobTrackingPage />} />
      </Route>

      {/* Partner and Admin placeholders - not touched in this pass */}
      <Route
        path="/partner/*"
        element={
          <div className="p-8 text-center">
            <h2 className="text-xl font-bold">Partner Portal</h2>
            <p className="text-sm text-slate-500">Partner interface will be built in the next pass.</p>
          </div>
        }
      />
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
