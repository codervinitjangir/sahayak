import { BrowserRouter, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth, UserRole } from './AuthProvider';
import { AppRoutes } from './routes';
import { ChevronDown } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const Navbar: React.FC = () => {
  const { role, setRole, user } = useAuth();

  // Extract clean display names
  const rawName = user?.name || '';
  const match = rawName.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  const mainName = match && match[1] ? match[1] : rawName;
  const subName = match && match[2] ? match[2] : '';
  const initial = mainName ? mainName.charAt(0).toUpperCase() : 'U';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/80">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Leftmost corner: Text-only Sahayak */}
        <Link
          to="/"
          className="font-bold text-lg tracking-tight text-[#181818] hover:opacity-80 transition-opacity"
        >
          Sahayak
        </Link>

        {/* Rightmost corner: Role Switcher + User Profile */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Refined Linear/Vercel Pill Role Selector */}
          <div className="relative flex items-center bg-neutral-50 hover:bg-neutral-100/80 border border-neutral-200/90 rounded-xl px-2.5 py-1 shadow-2xs transition-all">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Role</span>
              <span className="text-neutral-300">/</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="bg-transparent text-xs font-semibold text-[#181818] outline-none cursor-pointer pr-4 appearance-none hover:text-black focus:ring-0"
                aria-label="Switch User Role"
              >
                <option value="owner">Owner (Asha)</option>
                <option value="partner">Partner (Ramesh)</option>
                <option value="ops">Admin (Ops)</option>
              </select>
            </div>
            <ChevronDown className="w-3 h-3 text-neutral-400 pointer-events-none absolute right-2" />
          </div>

          {/* User Profile Pill with Avatar & Clean Typography */}
          <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-neutral-200">
            <div className="w-7 h-7 rounded-full bg-[#181818] text-white flex items-center justify-center font-bold text-[11px] shadow-2xs">
              {initial}
            </div>
            <div className="text-left text-xs leading-tight">
              <div className="font-bold text-[#181818] tracking-tight">{mainName}</div>
              <div className="text-[10px] text-neutral-500 font-mono">
                {subName ? `${subName} · ` : ''}{user?.phone}
              </div>
            </div>
          </div>
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
