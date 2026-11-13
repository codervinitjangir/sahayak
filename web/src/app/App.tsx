import { BrowserRouter, Link, NavLink, useLocation } from 'react-router-dom';
import { Home, LifeBuoy, LogOut } from 'lucide-react';
import { Logo } from '../components/Logo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthProvider';
import { AppRoutes } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

import { NotificationsDropdown } from '../components/NotificationsDropdown';

const OWNER_NAV = [
  { to: '/owner', label: 'Home', icon: Home, end: true },
  { to: '/owner/request', label: 'Request help', icon: LifeBuoy, end: false },
];

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const initial = (user?.name || 'U').trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" aria-label="Sahayak home">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden sm:flex items-center gap-1">
            {OWNER_NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center min-h-[44px] px-3 rounded-control text-sm font-semibold transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-soft hover:text-ink hover:bg-slate-50'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationsDropdown />
          {user ? (
            <div className="flex items-center gap-3 pl-3 border-l border-line">
              <span
                className="w-9 h-9 rounded-full bg-brand-700 text-white flex items-center justify-center font-semibold text-sm"
                aria-hidden="true"
              >
                {initial}
              </span>
              <div className="hidden md:block text-left leading-tight">
                <div className="text-sm font-semibold">{user.name}</div>
                <div className="text-xs text-ink-muted tnum">{user.phone}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-2 text-sm font-semibold text-ink-soft hover:text-ink"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
                <span className="sr-only sm:hidden">Sign out</span>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center min-h-[44px] px-4 rounded-control border border-brand-700/30 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

/** Bottom tab bar for phones; the top nav takes over from 640px. */
const MobileTabBar: React.FC = () => (
  <nav
    aria-label="Primary"
    className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line safe-bottom"
  >
    <ul className="grid grid-cols-2">
      {OWNER_NAV.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 min-h-[56px] text-xs font-semibold ${
                isActive ? 'text-brand-700' : 'text-ink-muted'
              }`
            }
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);

const AppContent: React.FC = () => {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isLogin = location.pathname === '/login' || location.pathname === '/terms' || location.pathname === '/privacy';
  const isPartnerPage = location.pathname.startsWith('/partner') || location.pathname.startsWith('/admin');

  if (isLanding || isLogin || isPartnerPage) {
    return (
      <main className="min-h-screen">
        <AppRoutes />
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <Navbar />
      <main className="flex-1 pb-24 sm:pb-16">
        <AppRoutes />
      </main>
      <MobileTabBar />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
