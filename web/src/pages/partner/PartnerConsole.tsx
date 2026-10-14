import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { PartnerDashboard, PartnerSidebar, CONSOLE_NAV, type ConsoleView } from './PartnerDashboard';
import { Preferences } from './Preferences';
import { VerificationStatus } from './VerificationStatus';
import { ConsoleSettingsView } from './ConsoleSettings';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { usePartnerProfile } from '../../features/partners/partnerStore';
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
  const { isAvailable } = usePartnerAvailability();

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
