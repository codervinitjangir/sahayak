import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Lock,
  SlidersHorizontal,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import {
  PartnerProfile,
  VerificationItem,
  isTier1Complete,
} from '../../types/partner';
import {
  getPartnerStoreState,
  updatePartnerProfile,
  usePartnerProfile,
} from '../../features/partners/partnerStore';
import { useAnnouncementToast } from '../../features/partners/useVerificationEvents';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { PartnerSidebar, type ConsoleView } from './PartnerDashboard';
import { PartnerTopBar } from './components/PartnerTopBar';
import './partner.css';

/* ── Row primitives ───────────────────────────────────────────────────────── */

const TYPE_ICON: Record<VerificationItem['type'], typeof FileText> = {
  document: FileText,
  service: Wrench,
  equipment: Truck,
};

const TYPE_CAPTION: Record<VerificationItem['type'], string> = {
  document: 'Identity document',
  service: 'Service capability',
  equipment: 'Equipment capability',
};

/** Status as a dot and a word. A bordered, filled pill on every row turned a
 *  nine-item list into nine competing badges; the only state that still earns
 *  a coloured surface is the one the partner has to do something about. */
const STATUS_META: Record<VerificationItem['status'], { label: string; dot: string; text: string }> = {
  complete: { label: 'Approved', dot: 'bg-[#0F766E]', text: 'text-[#0F766E]' },
  in_progress: { label: 'In review', dot: 'bg-amber-500', text: 'text-amber-700' },
  requirements_due: { label: 'Action needed', dot: 'bg-rose-500', text: 'text-rose-700' },
  not_started: { label: 'Not started', dot: 'bg-[#C9C0AE]', text: 'text-[#9A917F]' },
};

const VerificationRow: React.FC<{
  item: VerificationItem;
  locked: boolean;
  onReupload: (itemId: string) => void;
}> = ({ item, locked, onReupload }) => {
  const Icon = TYPE_ICON[item.type];
  const meta = STATUS_META[item.status];
  const needsAction = !locked && item.status === 'requirements_due';

  return (
    <div role="listitem" className="px-4 border-b border-[#F0EADB] last:border-b-0">
      <div className="flex items-center gap-3 py-2.5">
        <span
          className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 ${
            locked ? 'bg-[#F6F1E6]' : 'bg-[#0F766E]/8'
          }`}
        >
          <Icon
            className={`w-3.5 h-3.5 ${locked ? 'text-[#C9C0AE]' : 'text-[#0F766E]'}`}
            aria-hidden="true"
          />
        </span>

        <div className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-[#1B1712] truncate leading-tight">
            {item.label}
          </span>
          <span className="block text-[10px] text-[#9A917F] font-medium mt-0.5">
            {TYPE_CAPTION[item.type]}
          </span>
        </div>

        {locked ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#9A917F] shrink-0">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Locked
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold shrink-0 ${meta.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
            {meta.label}
          </span>
        )}
      </div>

      {needsAction && (
        <div className="ml-10 mb-2.5 flex items-center justify-between gap-3 rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2">
          <span className="text-[11px] text-rose-800 leading-snug">
            {item.requirementsDueReason || item.rejectionReason || 'Please review and re-upload this document.'}
          </span>
          <button
            type="button"
            onClick={() => onReupload(item.id)}
            className="text-[11px] font-bold text-white bg-rose-700 hover:bg-rose-800 px-2.5 py-1 rounded-[6px] shrink-0 transition-colors"
            aria-label={`Re-upload ${item.label}`}
          >
            Re-upload
          </button>
        </div>
      )}
    </div>
  );
};

/** One bordered container per group, hairlines inside. */
const TierCard: React.FC<{
  tier: string;
  title: string;
  approved: number;
  total: number;
  children: React.ReactNode;
}> = ({ tier, title, approved, total, children }) => (
  <section className="bento-card overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#FBF8F1] border-b border-[#E7E0D2]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#0F766E] bg-[#0F766E]/10 px-1.5 py-0.5 rounded border border-[#0F766E]/20 shrink-0">
          {tier}
        </span>
        <h2 className="text-[13px] font-bold text-[#1B1712] truncate">{title}</h2>
      </div>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5B5346] shrink-0 tabular-nums">
        {approved === total && total > 0 && (
          <CheckCircle2 className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
        )}
        {approved} of {total} approved
      </span>
    </div>
    <div role="list">{children}</div>
  </section>
);

/* ── The view ─────────────────────────────────────────────────────────────── */

export const VerificationStatus: React.FC<{
  embedded?: boolean;
  /** Supplied by the console so in-page CTAs swap the view instead of
   *  remounting the shell through the router. */
  onNavigate?: (view: ConsoleView) => void;
}> = ({ embedded = false, onNavigate }) => {
  const profile = usePartnerProfile();
  const { isAvailable } = usePartnerAvailability();

  // The toast and the dashboard Inbox read the same store events, so a status
  // change can never be described one way here and another way there.
  const { toast, dismiss: dismissToast } = useAnnouncementToast();

  // Sync state changes to storage
  const updateProfile = (
    updater: (prev: PartnerProfile) => { nextProfile: PartnerProfile; notification?: { message: string; type: 'success' | 'warning' | 'info' } }
  ) => {
    const result = updater(getPartnerStoreState().profile);
    updatePartnerProfile(
      () => result.nextProfile,
      result.notification ? { message: result.notification.message, tone: result.notification.type } : undefined
    );
  };

  const items = profile.verificationItems;
  const tier1Items = items.filter((i) => i.tier === 'tier_1_identity');
  const tier2Items = items.filter((i) => i.tier === 'tier_2_capabilities');

  const tier1Done = isTier1Complete(profile);
  const tier1Approved = tier1Items.filter((i) => i.status === 'complete').length;
  const tier2Approved = tier2Items.filter((i) => i.status === 'complete').length;
  const approvedCount = items.filter((i) => i.status === 'complete').length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;
  const isFullyApproved = approvedCount === totalCount && totalCount > 0;
  const actionCount = items.filter((i) => i.status === 'requirements_due').length;

  const handleReupload = (itemId: string) => {
    const item = profile.verificationItems.find((i) => i.id === itemId);
    const itemName = item?.label || 'Item';

    updateProfile((prev) => {
      const updated = prev.verificationItems.map((i) =>
        i.id === itemId
          ? { ...i, status: 'in_progress' as const, rejectionReason: undefined, requirementsDueReason: undefined }
          : i
      );

      return {
        nextProfile: { ...prev, verificationItems: updated },
        notification: {
          message: `${itemName} re-uploaded — now under review.`,
          type: 'info',
        },
      };
    });
  };

  // One sentence for the whole account, chosen by state rather than stacked as
  // four separate banners.
  const headlineState = isFullyApproved
    ? 'Fully verified'
    : actionCount > 0
      ? `${actionCount} item${actionCount > 1 ? 's' : ''} need${actionCount > 1 ? '' : 's'} you`
      : tier1Done
        ? 'Identity cleared'
        : 'Identity in review';

  const headlineDetail = isFullyApproved
    ? 'Every check has cleared. You can take any dispatch you are configured for.'
    : actionCount > 0
      ? 'Re-upload the flagged documents to resume review.'
      : tier1Done
        ? 'Capability checks are with the review team.'
        : 'Tier 2 capabilities unlock once all identity documents are approved.';

  // `embedded` means the console shell is already around us — see the same
  // switch on PartnerDashboard. Standalone, this page still draws its own
  // sidebar so a direct mount is never a bare fragment.
  const body = (
    <>
      {/* Status-Change Toast Notification */}
      {toast && (
        <aside
          aria-label="Status notification"
          className={`fixed top-4 right-4 z-50 max-w-sm w-full p-4 rounded-[14px] shadow-lg border flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-3 duration-200 ${
            toast.tone === 'warning'
              ? 'bg-[#FDF8F0] border-[#F2C582] text-[#5B5346]'
              : toast.tone === 'info'
                ? 'bg-sky-50 border-sky-300 text-sky-900'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {toast.tone === 'warning' ? (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-75">Status Update</p>
              <p className="text-sm font-semibold mt-0.5 leading-snug">{toast.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissToast}
            className="p-1 rounded-md hover:bg-black/5 text-[#5B5346] transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </aside>
      )}

      {/* Header. One row of console chrome, one title block — the search field
          that used to sit here filtered nine rows, which is a control that
          costs more to read than the list it searches. */}
      <header className="w-full flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[11px] font-bold tracking-wider text-[#0F766E] uppercase bg-[#0F766E]/10 px-2 py-0.5 rounded-full border border-[#0F766E]/20">
              Compliance &amp; Credentials
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-[#E7E0D2] text-[#5B5346]">
              {profile.category === 'both'
                ? 'Tow & Mechanic'
                : profile.category === 'towing'
                  ? 'Towing'
                  : profile.category === 'mechanical'
                    ? 'Mechanic'
                    : 'Fuel Delivery'}
            </span>
            <span className="text-xs font-mono text-[#9A917F] font-medium">ID: {profile.id}</span>
          </div>
          <h1 className="font-['Fraunces'] text-2xl sm:text-3xl font-semibold text-[#1B1712] tracking-tight">
            Verification Status
          </h1>
          <p className="text-xs text-[#5B5346] mt-0.5">
            RTO licensing, government identity gating and rescue vehicle inspection
          </p>
        </div>

      </header>

      {/* Checklist left, status rail right. The rail is what stops this page
          reading as one long scroll: the summary and the actions stay on screen
          while the list moves under them. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start pb-6">
        <div className="lg:col-span-8 flex flex-col gap-4 min-w-0">
          <TierCard tier="Tier 1" title="Identity Verification" approved={tier1Approved} total={tier1Items.length}>
            {tier1Items.map((item) => (
              <VerificationRow key={item.id} item={item} locked={false} onReupload={handleReupload} />
            ))}
          </TierCard>

          <TierCard tier="Tier 2" title="Services & Equipment" approved={tier2Approved} total={tier2Items.length}>
            {!tier1Done && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#FDF8F0] border-b border-[#F2C582] text-xs text-[#5B5346]">
                <Lock className="w-4 h-4 text-[#C05621] shrink-0" />
                <span>
                  <strong>Identity verification required:</strong> Complete identity verification first before Tier 2
                  capabilities unlock.
                </span>
              </div>
            )}
            {tier2Items.map((item) => (
              <VerificationRow key={item.id} item={item} locked={!tier1Done} onReupload={handleReupload} />
            ))}
          </TierCard>
        </div>

        <aside className="lg:col-span-4 verification-rail flex flex-col gap-4 min-w-0">
          {/* Where the account stands, stated once. The old header printed
              "6 of 9 items approved" and "67% completed" side by side, which is
              the same fact in two encodings. */}
          <section className="bento-card p-5">
            <div className="flex items-center gap-4">
              <div
                className="verification-ring relative"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Verification progress"
                style={{ ['--ring-sweep' as string]: `${progressPercent * 3.6}deg` }}
              >
                <div className="verification-ring__inner">
                  <span className="font-['Fraunces'] text-[13px] font-semibold text-[#1B1712] tabular-nums">
                    {approvedCount}/{totalCount}
                  </span>
                </div>
              </div>

              <div className="min-w-0">
                <div className="font-['Fraunces'] text-base font-semibold text-[#1B1712] leading-tight">
                  {headlineState}
                </div>
                <p className="text-[11px] text-[#5B5346] mt-1 leading-snug">{headlineDetail}</p>
              </div>
            </div>

            {/* The gate, as a two-step tracker. This used to be a grey sentence
                repeated under the Tier 1 heading. */}
            <div className="mt-4 pt-3.5 border-t border-[#E7E0D2] flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                    tier1Done ? 'bg-[#0F766E] text-white' : 'bg-[#EFE8DA] text-[#9A917F]'
                  }`}
                >
                  {tier1Done ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> : '1'}
                </span>
                <span className="text-[11px] font-semibold text-[#1B1712] flex-1 truncate">Identity documents</span>
                <span className="text-[11px] font-semibold text-[#5B5346] tabular-nums shrink-0">
                  {tier1Approved}/{tier1Items.length}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                    tier2Items.length > 0 && tier2Approved === tier2Items.length
                      ? 'bg-[#0F766E] text-white'
                      : 'bg-[#EFE8DA] text-[#9A917F]'
                  }`}
                >
                  {tier2Items.length > 0 && tier2Approved === tier2Items.length ? (
                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    '2'
                  )}
                </span>
                <span className={`text-[11px] font-semibold flex-1 truncate ${tier1Done ? 'text-[#1B1712]' : 'text-[#9A917F]'}`}>
                  Services &amp; equipment
                </span>
                <span className="text-[11px] font-semibold text-[#5B5346] tabular-nums shrink-0">
                  {tier2Approved}/{tier2Items.length}
                </span>
              </div>
            </div>
          </section>

          {/* Where to go next */}
          <section className="bento-card p-5 flex flex-col gap-2.5">
            {onNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate('preferences')}
                className="w-full inline-flex items-center gap-2 font-bold rounded-[10px] text-white bg-[#0F766E] hover:bg-[#0D645D] px-3.5 py-2.5 text-xs transition-all shadow-xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Manage Preferences &amp; Availability</span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto shrink-0" />
              </button>
            ) : (
              <Link
                to="/partner/preferences"
                className="w-full inline-flex items-center gap-2 font-bold rounded-[10px] text-white bg-[#0F766E] hover:bg-[#0D645D] px-3.5 py-2.5 text-xs transition-all shadow-xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Manage Preferences &amp; Availability</span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto shrink-0" />
              </Link>
            )}

            {!embedded && (
              <Link
                to="/partner/dashboard"
                className="w-full inline-flex items-center gap-2 font-semibold rounded-[10px] bg-white hover:bg-[#FBF8F1] border border-[#E7E0D2] px-3.5 py-2.5 text-xs text-[#1B1712] transition-all"
              >
                <Truck className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
                <span className="truncate">Live Dispatches</span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto shrink-0 text-[#9A917F]" />
              </Link>
            )}
          </section>
        </aside>
      </div>
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
