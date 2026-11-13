import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { usePartnerServices, usePartnerTrustStats } from '../../features/partners/useOffers';
import { usePartnerProfile } from '../../features/partners/partnerStore';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { PartnerSidebar, type ConsoleView } from './PartnerDashboard';
import { PartnerTopBar } from './components/PartnerTopBar';
import './partner.css';

type Meta = {
  title: string;
  body: string;
  Icon: typeof Clock;
  tone: string;
  ring: string;
};

/**
 * What each backend `verification_status` means to the partner. The account has
 * one decision, made by the Sahayak team; there is no per-document upload in the
 * product, so this page does not pretend to track one.
 */
function metaFor(status: string | undefined): Meta {
  switch (status) {
    case 'verified':
      return {
        title: 'You are verified',
        body: 'The Sahayak team has verified your account. You can go on duty and receive job offers.',
        Icon: CheckCircle2,
        tone: 'text-status-success',
        ring: 'bg-green-50 border-green-200',
      };
    case 'rejected':
      return {
        title: 'Verification was not approved',
        body: 'Your registration was reviewed and not approved. Contact the Sahayak team to find out why and what you can do next.',
        Icon: XCircle,
        tone: 'text-emergency-700',
        ring: 'bg-emergency-50 border-emergency-100',
      };
    case 'suspended':
      return {
        title: 'Your account is suspended',
        body: 'You will not receive offers while your account is suspended. Contact the Sahayak team.',
        Icon: AlertCircle,
        tone: 'text-emergency-700',
        ring: 'bg-emergency-50 border-emergency-100',
      };
    case 'pending':
      return {
        title: 'Verification pending',
        body: 'The Sahayak team verifies every partner before they can receive jobs. You do not need to do anything else right now. This page updates when the status changes.',
        Icon: Clock,
        tone: 'text-status-warning',
        ring: 'bg-amber-50 border-amber-200',
      };
    default:
      return {
        title: 'Checking your status…',
        body: 'We are loading your verification status.',
        Icon: Clock,
        tone: 'text-ink-soft',
        ring: 'bg-slate-50 border-line',
      };
  }
}

export const VerificationStatus: React.FC<{
  embedded?: boolean;
  /** Supplied by the console so in-page links swap the view instead of navigating. */
  onNavigate?: (view: ConsoleView) => void;
}> = ({ embedded = false, onNavigate }) => {
  const profile = usePartnerProfile();
  const { isAvailable } = usePartnerAvailability();
  const stats = usePartnerTrustStats();
  const services = usePartnerServices();

  const status = stats.data?.verificationStatus;
  const meta = metaFor(status);
  const verified = status === 'verified';
  const Icon = meta.Icon;

  const steps = [
    { label: 'You registered', done: true },
    { label: 'The Sahayak team reviews your account', done: verified || status === 'rejected' || status === 'suspended' },
    { label: 'You go on duty and receive offers', done: verified && isAvailable },
  ];

  const body = (
    <>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Verification Status</h1>
        <p className="text-ink-soft mt-1">Only verified partners are offered jobs.</p>
      </header>

      {stats.isError ? (
        <div className="bento-card p-5" role="alert">
          <p className="text-emergency-700 font-semibold">We could not load your verification status.</p>
          <button
            type="button"
            onClick={() => void stats.refetch()}
            className="mt-3 min-h-[44px] px-4 rounded-control border border-line font-semibold hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      ) : (
        <section
          aria-label="Account verification"
          className={`rounded-card border p-5 sm:p-6 flex gap-4 ${meta.ring}`}
        >
          <Icon className={`w-8 h-8 shrink-0 ${meta.tone}`} aria-hidden="true" />
          <div>
            <h2 className={`text-xl font-bold ${meta.tone}`}>{meta.title}</h2>
            <p className="mt-1 text-ink-soft leading-relaxed">{meta.body}</p>
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <section aria-label="What happens next" className="bento-card p-5">
          <h2 className="font-semibold text-lg mb-3">What happens next</h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    s.done ? 'bg-brand-700 text-white' : 'bg-slate-100 text-ink-muted'
                  }`}
                  aria-hidden="true"
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <span className={s.done ? 'font-semibold' : 'text-ink-soft'}>
                  {s.label}
                  {s.done && <span className="sr-only"> (done)</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Services" className="bento-card p-5">
          <h2 className="font-semibold text-lg mb-3">Services on your account</h2>
          {services.isLoading ? (
            <p className="text-ink-muted" role="status">Loading…</p>
          ) : services.isError ? (
            <p className="text-emergency-700" role="alert">We could not load your services.</p>
          ) : (services.data ?? []).length === 0 ? (
            <p className="text-ink-soft">No services are linked to your account yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {(services.data ?? []).map((s) => (
                <li key={s.service_id} className="text-sm font-semibold bg-canvas border border-line px-3 py-1 rounded-full">
                  {s.name}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-muted">
            Services that need equipment, like towing, are enabled once the Sahayak team has verified it.
          </p>
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate('preferences')}
              className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] font-semibold text-brand-700 hover:underline"
            >
              Change services <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              to="/partner/preferences"
              className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] font-semibold text-brand-700 hover:underline"
            >
              Change services <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          )}
        </section>
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
        <ShieldCheck className="w-4 h-4 text-brand-700" aria-hidden="true" />
        Registered number: <span className="tnum font-medium text-ink-soft">{profile.phone || 'not available'}</span>
      </p>
    </>
  );

  if (embedded) return body;

  return (
    <div className="partner-shell">
      <PartnerSidebar profile={profile} isAvailable={isAvailable} activeNav="verification" />
      <main className="partner-main-canvas flex flex-col">
        <PartnerTopBar profile={profile} />
        {body}
      </main>
    </div>
  );
};

export default VerificationStatus;
