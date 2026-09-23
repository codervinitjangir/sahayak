import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Shield, CheckCircle2 } from 'lucide-react';
import { usersService } from '../../services/users.service';
import { useAuth } from '../../app/AuthProvider';
import { Button } from '../../components/ui/Button';

export const OwnerSignup: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/owner';
  const { setRole } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/\D/g, '');

    if (!cleanName || cleanName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setIsSubmitting(true);
    try {
      await usersService.createUser({
        name: cleanName,
        phone: `+91${cleanPhone}`,
        email: email.trim() || undefined,
        role: 'owner',
      });

      setRole('owner');
      navigate(redirectPath, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Brand / Logo */}
        <div className="text-center mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-2xl font-black text-slate-900 tracking-tight"
          >
            <span className="w-8 h-8 rounded-lg bg-brand-700 text-white flex items-center justify-center text-base font-bold shadow-sm">
              S
            </span>
            <span>Sahayak</span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            Create Vehicle Owner Account
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Instant emergency dispatch & vehicle tracking across Bengaluru
          </p>
        </div>

        {/* Card */}
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 rounded-2xl sm:px-10">
          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="owner-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="owner-name"
                type="text"
                placeholder="e.g. Asha Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="owner-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Mobile Number
              </label>
              <div className="flex rounded-xl border border-slate-300 overflow-hidden focus-within:border-brand-700 focus-within:ring-1 focus-within:ring-brand-700">
                <span className="inline-flex items-center px-3 bg-slate-50 border-r border-slate-200 text-xs font-semibold text-slate-600">
                  +91
                </span>
                <input
                  id="owner-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="flex-1 px-3.5 py-2.5 bg-white text-sm text-slate-900 outline-none"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Used to coordinate arrival when a partner is dispatched.
              </p>
            </div>

            <div>
              <label htmlFor="owner-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                id="owner-email"
                type="email"
                placeholder="asha@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:border-brand-700 focus:ring-1 focus:ring-brand-700 outline-none"
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                className="w-full font-bold shadow-md bg-brand-700 hover:bg-brand-800"
              >
                <span>Register & Continue</span>
              </Button>
            </div>
          </form>

          {/* Trust Badges */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-brand-700" />
              Verified Network
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-brand-700" />
              No Hidden Charges
            </span>
          </div>

          <div className="mt-5 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Sign In
            </Link>
          </div>
        </div>

        <div className="mt-4 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default OwnerSignup;
