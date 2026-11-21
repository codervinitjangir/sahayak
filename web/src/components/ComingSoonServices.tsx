import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing, Check, ChevronDown, GraduationCap, Home, KeyRound, Truck, Wallet, type LucideIcon,
} from 'lucide-react';
import { Badge } from './ui/Badge';
import { featureInterestService, type ComingSoonFeature } from '../services/featureInterest.service';

export interface ComingSoonItem {
  id: ComingSoonFeature;
  icon: LucideIcon;
  title: string;
  blurb: string;
  detail: string;
}

// Announced only. None of these exist yet (docs/FUTURE-ROADMAP.md), so the cards
// carry no price, slot or booking action. "Notify me" records interest (ADR-035).
// B2B is deliberately not here: it stays in the roadmap until it has its own panel.
// Scheduled service shipped on 2026-11-21 (ADR-050) and left this list.
export const OWNER_COMING_SOON: readonly ComingSoonItem[] = [
  {
    id: 'doorstep',
    icon: Home,
    title: 'Doorstep repair',
    blurb: 'A verified mechanic repairs your vehicle at home.',
    detail:
      'The mechanic inspects your vehicle and sends a quote in the app. No work starts until you approve it.',
  },
  {
    id: 'pickup-drop',
    icon: Truck,
    title: 'Pick-up & drop',
    blurb: 'We take your vehicle to the workshop and bring it back.',
    detail:
      'Photos are taken at pick-up and again at drop, keys change hands with a one-time code, and you can follow the vehicle live while it is away.',
  },
];

export const PARTNER_COMING_SOON: readonly ComingSoonItem[] = [
  {
    id: 'financing',
    icon: Wallet,
    title: 'Partner financing',
    blurb: 'Loans for tools or a tow vehicle.',
    detail:
      'Get finance for equipment through a lending partner, repaid in small amounts from your Sahayak payouts.',
  },
  {
    id: 'certification',
    icon: GraduationCap,
    title: 'Training & certification',
    blurb: 'Short courses for EVs and newer vehicles.',
    detail:
      'Finish a course and earn a certification badge on your profile. Certified partners are matched to jobs that need the skill.',
  },
  {
    id: 'custody-tier',
    icon: KeyRound,
    title: 'Pick-up & drop partner',
    blurb: 'Take vehicles to your workshop and bring them back.',
    detail:
      'Open to verified workshops only: police verification, a site visit and a security deposit. These jobs pay more because you hold the vehicle.',
  },
];

export interface ComingSoonServicesProps {
  /** Which profile is looking. Keeps an owner's and a partner's lists apart when one login holds both (ADR-034). */
  side: 'owner' | 'partner';
  items: readonly ComingSoonItem[];
  note?: string;
}

export const ComingSoonServices: React.FC<ComingSoonServicesProps> = ({ side, items, note = 'Not available yet' }) => {
  const [open, setOpen] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const key = ['feature-interest', side];
  const interest = useQuery({ queryKey: key, queryFn: () => featureInterestService.listMine() });
  const notify = useMutation({
    mutationFn: (f: ComingSoonFeature) => featureInterestService.register(f),
    onSuccess: (features) => queryClient.setQueryData(key, features),
  });
  const asked = new Set<string>(interest.data ?? []);
  const headingId = `coming-soon-heading-${side}`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id={headingId} className="text-lg font-bold">
          Coming soon
        </h2>
        <span className="text-sm text-ink-muted">{note}</span>
      </div>

      <ul className={`grid gap-3 ${items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {items.map(({ id, icon: Icon, title, blurb, detail }) => {
          const isOpen = open === id;
          return (
            <li key={id} className="rounded-card border border-line bg-white">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`coming-soon-${id}`}
                onClick={() => setOpen(isOpen ? null : id)}
                className="w-full text-left p-4 flex items-start gap-3 min-h-[88px]"
              >
                <span className="p-2.5 rounded-lg bg-slate-100 text-slate-700 shrink-0">
                  <Icon className="w-6 h-6" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{title}</span>
                    <Badge variant="neutral" size="sm">Coming soon</Badge>
                  </span>
                  <span className="block mt-1 text-sm text-ink-soft">{blurb}</span>
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-ink-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {isOpen && (
                <div id={`coming-soon-${id}`} className="px-4 pb-4 -mt-1 space-y-3">
                  <p className="text-sm text-ink-soft leading-relaxed">{detail}</p>
                  {asked.has(id) ? (
                    <p role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-status-success">
                      <Check className="w-4 h-4" aria-hidden="true" />
                      We will tell you when this launches
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => notify.mutate(id)}
                      disabled={notify.isPending || interest.isLoading}
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-control border border-line bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      <BellRing className="w-4 h-4" aria-hidden="true" />
                      {notify.isPending && notify.variables === id ? 'Saving…' : 'Notify me'}
                    </button>
                  )}
                  {notify.isError && notify.variables === id && (
                    <p role="alert" className="text-sm text-emergency-700">Could not save that. Please try again.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
