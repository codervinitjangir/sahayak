import { BrowserRouter, Link, useLocation } from 'react-router-dom';
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

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  // Extract clean display names
  const rawName = user?.name || '';
  const match = rawName.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  const mainName = match && match[1] ? match[1] : rawName;
  const subName = match && match[2] ? match[2] : '';
  const initial = mainName ? mainName.charAt(0).toUpperCase() : 'U';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/80">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Left: Brand + Owner navigation links */}
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="font-bold text-lg tracking-tight text-[#181818] hover:opacity-80 transition-opacity"
          >
            Sahayak
          </Link>
          <nav className="hidden sm:flex items-center gap-4 text-xs font-semibold text-slate-600">
            <Link to="/owner" className="hover:text-slate-900 transition-colors">
              Overview
            </Link>
            <Link to="/owner/request" className="hover:text-slate-900 transition-colors">
              Request Help
            </Link>
          </nav>
        </div>

        {/* Right: Owner Notifications Feed + User Profile */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Owner notifications feed */}
          <NotificationsDropdown />

          {/* User Profile Pill or Sign In Link */}
          {user ? (
            <div className="flex items-center gap-2.5 pl-3 border-l border-neutral-200">
              <div className="w-7 h-7 rounded-full bg-[#181818] text-white flex items-center justify-center font-bold text-[11px] shadow-2xs">
                {initial}
              </div>
              <div className="hidden sm:block text-left text-xs leading-tight">
                <div className="font-bold text-[#181818] tracking-tight">{mainName}</div>
                <div className="text-[10px] text-neutral-500 font-mono">
                  {subName ? `${subName} · ` : ''}{user?.phone}
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 ml-1 cursor-pointer"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="text-xs font-bold text-[#0F766E] hover:text-[#0D645D] px-3 py-1.5 rounded-lg border border-[#0F766E]/30 hover:bg-[#0F766E]/5 transition-all"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isLogin = location.pathname === '/login';
  const isPartnerPage = location.pathname.startsWith('/partner');

  if (isLanding || isLogin || isPartnerPage) {
    return (
      <main className="min-h-screen">
        <AppRoutes />
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-[#181818]">
      <Navbar />
      <main className={`flex-1 ${isPartnerPage ? 'overflow-hidden' : 'pb-16'}`}>
        <AppRoutes />
      </main>
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
