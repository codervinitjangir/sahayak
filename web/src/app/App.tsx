import { BrowserRouter, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth, UserRole } from './AuthProvider';
import { AppRoutes } from './routes';
import { Shield, LifeBuoy } from 'lucide-react';

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

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-brand-700 font-extrabold text-xl tracking-tight">
          <div className="p-1.5 rounded-lg bg-brand-700 text-white">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <span>Sahayak</span>
        </Link>

        <div className="flex items-center gap-3">
          {/* Role selector badge for rapid demo / preview */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <Shield className="w-3.5 h-3.5 text-slate-500 ml-1" />
            <span className="text-slate-500 font-medium">Role:</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="bg-white rounded border border-slate-200 font-bold text-brand-800 px-1.5 py-0.5 outline-none cursor-pointer"
              aria-label="Switch User Role"
            >
              <option value="owner">Owner (Asha)</option>
              <option value="partner">Partner (Ramesh)</option>
              <option value="ops">Admin (Ops)</option>
            </select>
          </div>

          <div className="hidden sm:block text-xs text-right">
            <span className="font-semibold text-slate-900 block">{user?.name}</span>
            <span className="text-slate-500 font-mono">{user?.phone}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  if (isLanding) {
    return (
      <main className="min-h-screen">
        <AppRoutes />
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-slate-900">
      <Navbar />
      <main className="flex-1 pb-16">
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
