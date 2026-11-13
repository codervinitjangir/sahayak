import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { serviceIcon } from '../../components/serviceIcon';
import { useServices } from '../../features/jobs/hooks';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { PARTNER_SERVICES_KEY, usePartnerServices, usePartnerTrustStats } from '../../features/partners/useOffers';
import { usePartnerProfile } from '../../features/partners/partnerStore';
import { partnerService } from '../../services/partner.service';
import { PartnerTopBar } from './components/PartnerTopBar';
import './partner.css';

/**
 * Services and duty.
 *
 * Both lists come from the backend: the catalogue from GET /services and the
 * partner's current links from GET /partners/me/services. Saving posts the full
 * set of codes. Nothing here is a local guess, and equipment is not collected
 * because no endpoint stores it; services that need it are enabled by the
 * Sahayak team once it is verified.
 */
export const Preferences: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const queryClient = useQueryClient();
  const profile = usePartnerProfile();
  const { isAvailable, toggle } = usePartnerAvailability();
  const stats = usePartnerTrustStats();
  const catalogue = useServices();
  const linked = usePartnerServices();

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Seed the checkboxes once, from what the backend says is linked today.
  useEffect(() => {
    if (selected === null && linked.data) setSelected(new Set(linked.data.map((s) => s.code)));
  }, [linked.data, selected]);

  const grouped = useMemo(() => {
    const out: Record<string, NonNullable<typeof catalogue.data>> = {};
    for (const s of catalogue.data ?? []) (out[s.category?.name ?? 'Services'] ||= []).push(s);
    return out;
  }, [catalogue.data]);

  const current = selected ?? new Set<string>();
  const saved = new Set((linked.data ?? []).map((s) => s.code));
  const dirty = selected !== null && (current.size !== saved.size || [...current].some((c) => !saved.has(c)));
  const partnerId = stats.data?.partnerId;

  const toggleService = (code: string) => {
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const save = async () => {
    if (!partnerId) {
      setMessage({ tone: 'error', text: 'Your partner account is still loading. Try again in a moment.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await partnerService.updateServices(partnerId, [...current]);
      await queryClient.invalidateQueries({ queryKey: PARTNER_SERVICES_KEY });
      setMessage({ tone: 'ok', text: 'Services saved. Dispatch will use them for your next offers.' });
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not save your services. Check your connection and try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const loading = catalogue.isLoading || linked.isLoading;
  const failed = catalogue.isError || linked.isError;
  const verified = stats.data?.verificationStatus === 'verified';

  const body = (
    <>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Services &amp; Preferences</h1>
        <p className="text-ink-soft mt-1">Choose what you want to be offered, and go on or off duty.</p>
      </header>

      {/* Duty */}
      <section
        className={`bento-card p-5 flex items-center justify-between gap-4 mb-4 ${
          isAvailable ? 'border-green-300 bg-green-50' : ''
        }`}
        aria-label="Duty status"
      >
        <div>
          <h2 className="font-semibold text-lg">{isAvailable ? 'On Duty' : 'Off Duty'}</h2>
          <p className="text-sm text-ink-soft mt-0.5">
            {isAvailable
              ? 'Dispatch can offer you jobs and sees your location.'
              : 'You will not receive offers and your location is not shared.'}
          </p>
          {!verified && stats.data && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-status-warning">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Offers start once the Sahayak team has verified your account.
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isAvailable}
          aria-label="Go on duty"
          onClick={toggle}
          className={`toggle-switch ${isAvailable ? 'toggle-switch--active' : ''}`}
        >
          <span className="toggle-switch__thumb" />
        </button>
      </section>

      {/* Services */}
      <section className="bento-card p-5" aria-label="Services you offer">
        <h2 className="font-semibold text-lg">Services you offer</h2>
        <p className="text-sm text-ink-soft mt-0.5 mb-4">
          {selected ? `${current.size} selected` : 'Loading your current services…'}
        </p>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height={56} className="w-full" />
            ))}
          </div>
        ) : failed ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" role="alert">
            <p className="text-emergency-700">We could not load your services.</p>
            <button
              type="button"
              onClick={() => {
                void catalogue.refetch();
                void linked.refetch();
              }}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-control border border-line font-semibold hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <fieldset key={category} className="mb-5 last:mb-0">
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">{category}</legend>
              <div className="grid sm:grid-cols-2 gap-3">
                {items.map((s) => {
                  const Icon = serviceIcon(s.code);
                  const on = current.has(s.code);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-start gap-3 p-3.5 rounded-card border-2 cursor-pointer min-h-[64px] transition-colors ${
                        on ? 'border-brand-700 bg-brand-50' : 'border-line bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleService(s.code)}
                        className="mt-1 w-5 h-5 accent-[#0F766E]"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-semibold">
                          <Icon className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
                          {s.name}
                        </span>
                        {s.requires_vehicle_equipment && (
                          <span className="block text-xs text-ink-muted mt-0.5">Needs equipment verified by Sahayak</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))
        )}

        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`mt-4 flex items-start gap-2 text-sm font-medium ${
              message.tone === 'error' ? 'text-emergency-700' : 'text-status-success'
            }`}
          >
            {message.tone === 'error' ? (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span>{message.text}</span>
          </p>
        )}

        <div className="mt-5 pt-4 border-t border-line flex justify-end">
          <Button onClick={save} isLoading={saving} disabled={!dirty || loading || failed}>
            Save services
          </Button>
        </div>
      </section>
    </>
  );

  if (embedded) return body;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <PartnerTopBar profile={profile} />
      {body}
    </div>
  );
};

export default Preferences;
