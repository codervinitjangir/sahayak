import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { PartnerDashboard, PartnerSidebar, CONSOLE_NAV, type ConsoleView } from './PartnerDashboard';
import { Preferences } from './Preferences';
import { VerificationStatus } from './VerificationStatus';
import { ConsoleSettingsView } from './ConsoleSettings';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../features/partners/partnerStore';
import { IS_PARTNER_API_MOCK, partnerService } from '../../services/partner.service';
import './partner.css';

function viewForPath(pathname: string): ConsoleView | undefined {
  return CONSOLE_NAV.find((item) => item.path === pathname)?.view;
}

/**
 * The Partner Console.
 *
 * All four sidebar destinations live here. Clicking one swaps the view in
 * place — the shell, the sidebar and the scroll container stay mounted and the
 * URL does not change. Before this, "Fleet & Preferences" navigated to a page
 * that had no sidebar at all, which visibly dropped the partner out of the
 * console mid-shift.
 *
 * The four URLs are still honoured on first load, so a bookmark or a link from
 * elsewhere in the app lands on the right view.
 */
export const PartnerConsole: React.FC = () => {
  const { pathname } = useLocation();
  const [view, setView] = useState<ConsoleView>(() => viewForPath(pathname) ?? 'dispatches');

  // One element serves all four console paths, so React Router keeps this
  // instance mounted across them and the initializer above never re-runs. A
  // <Link> from inside the console (the TopBar's Messages button, the cards'
  // shortcuts) would otherwise change the URL and leave the view behind.
  // Sidebar clicks never touch the pathname, so they are unaffected by this.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const next = viewForPath(pathname);
    if (next) setView(next);
  }, [pathname]);

  const profile = usePartnerProfile();
  const { isAvailable } = usePartnerAvailability();

  // The sidebar's "simulate" affordance only makes sense against mock data.
  const simulate = IS_PARTNER_API_MOCK
    ? () => {
        void partnerService.simulateIncomingOffer();
      }
    : undefined;

  return (
    <div className="partner-shell">
      <PartnerSidebar
        profile={profile}
        isAvailable={isAvailable}
        activeNav={view}
        onNavigate={setView}
        onSimulate={simulate}
      />

      {/* One canvas, one scroll region. Each view renders `embedded`, so it
          contributes only its own content and never a second shell. */}
      <main className="partner-main-canvas flex flex-col">
        {view === 'dispatches' && <PartnerDashboard embedded />}
        {view === 'preferences' && <Preferences embedded />}
        {view === 'verification' && <VerificationStatus embedded onNavigate={setView} />}
        {view === 'settings' && <ConsoleSettingsView embedded onNavigate={setView} />}
      </main>
    </div>
  );
};

export default PartnerConsole;
