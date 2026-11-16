import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { PartnerDashboard, PartnerSidebar, CONSOLE_NAV, type ConsoleView } from './PartnerDashboard';
import { Preferences } from './Preferences';
import { VerificationStatus } from './VerificationStatus';
import { ConsoleSettingsView } from './ConsoleSettings';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { updatePartnerProfile, usePartnerProfile } from '../../features/partners/partnerStore';
import { usePartnerTrustStats } from '../../features/partners/useOffers';
import { ApiError } from '../../services/api';
import { partnerService } from '../../services/partner.service';
import { PartnerTopBar } from './components/PartnerTopBar';
import './partner.css';

function viewForPath(pathname: string): ConsoleView | undefined {
  return CONSOLE_NAV.find((item) => item.path === pathname)?.view;
}

/**
 * The Partner Console.
 *
 * All four sidebar destinations live here. Clicking one swaps the view in
 * place — the shell, the sidebar and the scroll container stay mounted and the
 * URL does not change.
 */
export const PartnerConsole: React.FC = () => {
  const { pathname } = useLocation();
  const [view, setView] = useState<ConsoleView>(() => viewForPath(pathname) ?? 'dispatches');

  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const next = viewForPath(pathname);
    if (next) setView(next);
  }, [pathname]);

  const profile = usePartnerProfile();
  const { isAvailable, setAvailable } = usePartnerAvailability();

  // GET /partners/me/stats is the cheapest call that proves this token belongs
  // to a partner. Until it succeeds nothing partner-specific is shown, so an
  // owner or a signed-out visitor never sees an "on duty / verified" console.
  const stats = usePartnerTrustStats();

  // Keep the stored id in step with the server (availability and location
  // calls are addressed by it), and re-assert a remembered on-duty state so the
  // switch never says "on duty" while dispatch thinks otherwise.
  const synced = useRef(false);
  useEffect(() => {
    const partnerId = stats.data?.partnerId;
    if (!partnerId || synced.current) return;
    synced.current = true;
    if (profile.id !== partnerId) updatePartnerProfile((prev) => ({ ...prev, id: partnerId }));
    if (profile.isAvailable) {
      partnerService.setAvailability(true, partnerId).catch(() => setAvailable(false));
    }
  }, [stats.data?.partnerId, profile.id, profile.isAvailable, setAvailable]);

  if (stats.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8FA]">
        <p className="text-sm text-[#475569]" role="status">Loading partner console…</p>
      </div>
    );
  }

  if (stats.isError || !stats.data) {
    const err = stats.error;
    const notPartner = err instanceof ApiError && [401, 403, 404].includes(err.status);
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8FA] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#EEF2F6] p-6 text-center" role="alert">
          <h1 className="text-lg font-bold text-[#0F172A]">
            {notPartner ? 'This account is not a service partner' : 'Could not load the partner console'}
          </h1>
          <p className="mt-2 text-sm text-[#475569]">
            {notPartner
              ? 'Sign in with the mobile number you registered as a partner, or register your workshop first.'
              : 'Check your connection and try again.'}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {notPartner ? (
              <>
                <Link to="/partner/signup" className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[#111111] text-white font-bold">
                  Register as a partner
                </Link>
                <Link to="/login" className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-[#EEF2F6] font-bold text-[#0F172A]">
                  Sign in
                </Link>
              </>
            ) : (
              <button type="button" onClick={() => void stats.refetch()} className="min-h-[44px] rounded-xl bg-[#111111] text-white font-bold">
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="partner-shell">
      <PartnerSidebar
        profile={profile}
        isAvailable={isAvailable}
        activeNav={view}
        onNavigate={setView}
      />

      {/* One canvas, one scroll region. Each view renders `embedded`, so it
          contributes only its own content and never a second shell. */}
      <main className="partner-main-canvas flex flex-col">
        <PartnerTopBar profile={profile} />
        {view === 'dispatches' && <PartnerDashboard embedded />}
        {view === 'preferences' && <Preferences embedded />}
        {view === 'verification' && <VerificationStatus embedded onNavigate={setView} />}
        {view === 'settings' && <ConsoleSettingsView embedded onNavigate={setView} />}
      </main>
    </div>
  );
};

export default PartnerConsole;
