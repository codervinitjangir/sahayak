import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Car, MapPin, Wrench } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { usePartnerAvailability } from '../../features/partners/usePartnerAvailability';
import { PARTNER_OFFER_KEY, useActiveJob, useOfferResponse, usePendingOffer } from '../../features/partners/useOffers';
import { useOfferCountdown } from '../../features/partners/offerCountdown';
import { OfferCountdown } from '../../features/partners/OfferCountdownPill';
import './partner.css';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/**
 * The full-page view of the offer the dashboard shows inline.
 * Accept / reject come from useOfferResponse. The offer expires 60 s after it
 * was made (ADR-032); the countdown shows how long is left.
 */
export const OffersPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAvailable } = usePartnerAvailability();

  const activeJobQuery = useActiveJob();
  const activeJob = activeJobQuery.data ?? null;

  const offerQuery = usePendingOffer(isAvailable && !activeJobQuery.isLoading && !activeJob);
  const offer = offerQuery.data ?? null;

  const { accept, reject, isResponding, error } = useOfferResponse();
  const countdown = useOfferCountdown(offer, PARTNER_OFFER_KEY);

  const handleAccept = async () => {
    if (!offer) return;
    const job = await accept(offer.id);
    navigate(job ? `/partner/jobs/${job.id}` : '/partner/dashboard');
  };

  const handleReject = async () => {
    if (!offer) return;
    await reject(offer.id);
    navigate('/partner/dashboard');
  };

  return (
    <div className="min-h-full bg-bg overflow-y-auto">
      <div className="mx-auto w-full max-w-xl lg:max-w-2xl px-4 py-4 space-y-3 pb-8">
        <Link
          to="/partner/dashboard"
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-slate-500 hover:text-slate-800 focus:ring-2 focus:ring-slate-600 focus:outline-none rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Dashboard
        </Link>

        {error && (
          <p
            role="status"
            className="flex items-center gap-2 bg-amber-50 border border-status-warning/30 rounded-xl px-4 py-3 text-sm font-semibold text-status-warning"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {!offer ? (
          <Card aria-label="No offer">
            <p className="text-base font-bold text-slate-900">No offer on the board</p>
            <p className="mt-1 text-sm text-slate-500">
              {isAvailable
                ? 'Nothing is being offered to you at the moment. The dashboard will surface the next one as it arrives.'
                : 'You are off duty, so dispatch is not sending you offers.'}
            </p>
            <Button variant="outline" size="md" className="mt-3 w-full" onClick={() => navigate('/partner/dashboard')}>
              Back to dashboard
            </Button>
          </Card>
        ) : (
          <>
            <Card aria-label="Offer details" className="border-brand-700">
              <CardHeader eyebrow="Offer" title={offer.serviceName} />

              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
                <span>Dispatch offer active</span>
                <OfferCountdown countdown={countdown} />
              </div>

              <dl className="mt-4 space-y-3">
                {offer.slot ? (
                  <div className="rounded-control border border-sky-300 bg-sky-50 px-3 py-2">
                    <dt className="text-xs font-bold uppercase tracking-wider text-sky-900">Booked job</dt>
                    <dd className="text-base font-semibold text-sky-900">Arrive {offer.slot}</dd>
                  </div>
                ) : null}
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Pickup</dt>
                    <dd className="text-base text-slate-900">{offer.pickupAddressText}</dd>
                    <dd className="text-sm text-slate-500">
                      {formatDistance(offer.distanceAtOfferM)} from your last location
                    </dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Car className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Vehicle</dt>
                    <dd className="text-base text-slate-900">{offer.vehicleNumber}</dd>
                  </div>
                </div>

                {offer.issueDescription && (
                  <div className="flex items-start gap-3">
                    <Wrench className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">Reported issue</dt>
                      <dd className="text-base text-slate-900">{offer.issueDescription}</dd>
                    </div>
                  </div>
                )}

                {/* No payout quoted by dispatch ⇒ no payout line. Printing "₹0"
                    would read as "this job pays nothing", which is a lie. */}
                {offer.payoutEstimate !== undefined && (
                  <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-slate-500">Estimated payout</dt>
                    <dd className="text-xl font-extrabold text-slate-900 tabular-nums">
                      ₹{RUPEES.format(offer.payoutEstimate)}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>

            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="flex-1" disabled={isResponding} onClick={handleReject}>
                Reject
              </Button>
              <Button variant="primary" size="lg" className="flex-1" disabled={isResponding || countdown.expired} onClick={handleAccept}>
                Accept
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
