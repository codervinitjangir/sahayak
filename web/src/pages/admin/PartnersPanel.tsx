import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Phone,
  Star,
  FileText,
  Truck,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

import {
  adminService,
  AdminPartnerDetail,
  AdminPartnerSummary,
  PartnerVerificationStatus,
} from '../../services/admin.service';
import { Modal } from '../../components/ui/Modal';

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected';

const label = (v: string | null) => (v ? v.replace(/_/g, ' ') : 'unknown');

export const PartnersPanel: React.FC = () => {
  const [partners, setPartners] = useState<AdminPartnerSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPartners = async (status?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminService.listPartners(status === 'all' ? undefined : status);
      setPartners(res.items);
    } catch (err: any) {
      setError(err?.message || 'Could not load partner list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPartners(statusFilter);
  }, [statusFilter]);

  // Review dialog: one partner's documents/equipment, and the reject-reason prompt.
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPartnerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const closeReview = () => {
    setReviewId(null);
    setDetail(null);
    setDetailError(null);
    setRejecting(false);
    setReason('');
    setActionError(null);
  };

  const openReview = async (partnerId: string) => {
    setReviewId(partnerId);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await adminService.getPartner(partnerId));
    } catch (err: any) {
      setDetailError(err?.message || 'Could not load partner details');
    }
  };

  const handleUpdateStatus = async (
    partnerId: string,
    newStatus: PartnerVerificationStatus,
    notes?: string,
  ): Promise<boolean> => {
    setActionLoadingId(partnerId);
    setActionError(null);
    try {
      const updated = await adminService.verifyPartner(partnerId, newStatus, notes);
      setPartners((prev) => prev.map((p) => (p.id === partnerId ? { ...p, ...updated } : p)));
      setDetail((d) => (d && d.id === partnerId ? { ...d, ...updated } : d));
      return true;
    } catch (err: any) {
      setActionError(err?.message || 'Network error — status not changed');
      return false;
    } finally {
      setActionLoadingId(null);
    }
  };

  const submitReject = async () => {
    if (!reviewId) return;
    if (reason.trim().length < 3) {
      setActionError('Enter a reason of at least 3 characters.');
      return;
    }
    if (await handleUpdateStatus(reviewId, 'rejected', reason.trim())) {
      setRejecting(false);
      setReason('');
    }
  };

  const filteredPartners = partners.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (p.name ?? '').toLowerCase().includes(q) ||
      p.phone.toLowerCase().includes(q)
    );
  });

  const pendingCount = partners.filter((p) => p.verification_status === 'pending').length;
  const verifiedCount = partners.filter((p) => p.verification_status === 'verified').length;
  const rejectedCount = partners.filter((p) => p.verification_status === 'rejected').length;

  return (
    <div className="space-y-6">
      {/* ── Section Title & Filter Controls ── */}
      <div className="bg-white rounded-[16px] border border-[#EEF2F6] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#111111]" />
              <h2 className="text-lg font-bold text-[#0F172A]">
                Mechanic & Workshop Verification
              </h2>
            </div>
            <p className="text-xs text-[#475569] mt-1">
              Review incoming partner registrations, inspect workshop credentials, and grant dispatch eligibility.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchPartners(statusFilter)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[8px] border border-[#EEF2F6] bg-white hover:bg-[#F6F8FA] text-[#0F172A] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#111111] ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="mt-4 pt-4 border-t border-[#EEF2F6] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Status:
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition-all ${
                statusFilter === 'all'
                  ? 'bg-[#0F172A] text-white shadow-2xs'
                  : 'text-[#475569] hover:bg-[#F6F8FA]'
              }`}
            >
              All ({partners.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition-all flex items-center gap-1.5 ${
                statusFilter === 'pending'
                  ? 'bg-[#D97706] text-white shadow-2xs'
                  : 'text-[#92400E] bg-[#FEF3C7] hover:bg-[#FDE68A]'
              }`}
            >
              <Clock className="w-3 h-3" />
              Pending ({pendingCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('verified')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition-all flex items-center gap-1.5 ${
                statusFilter === 'verified'
                  ? 'bg-[#111111] text-white shadow-2xs'
                  : 'text-[#065F46] bg-[#D1FAE5] hover:bg-[#A7F3D0]'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              Verified ({verifiedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('rejected')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition-all flex items-center gap-1.5 ${
                statusFilter === 'rejected'
                  ? 'bg-[#B91C1C] text-white shadow-2xs'
                  : 'text-[#991B1B] bg-[#FEE2E2] hover:bg-[#FECACA]'
              }`}
            >
              <XCircle className="w-3 h-3" />
              Rejected ({rejectedCount})
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search partner or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-8 pr-3 py-1.5 text-xs rounded-[8px] border border-[#EEF2F6] bg-white text-[#0F172A] focus:outline-none focus:border-[#111111]"
            />
          </div>
        </div>
      </div>

      {/* ── Partner List ── */}
      {error ? (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-[16px] p-6 text-center text-xs text-[#92400E]">
          {error}
        </div>
      ) : loading ? (
        <div className="py-20 text-center">
          <RefreshCw className="w-6 h-6 text-[#111111] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#475569]">Loading partners from database…</p>
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="bg-white rounded-[16px] border border-[#EEF2F6] p-12 text-center shadow-2xs">
          <ShieldCheck className="w-10 h-10 text-[#64748B] mx-auto mb-3 opacity-60" />
          <h3 className="text-base font-bold text-[#0F172A]">No Partners Found</h3>
          <p className="text-xs text-[#475569] mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No partners matched "${searchQuery}". Clear your search term to view all registered partners.`
              : `There are currently no partners with status "${statusFilter}".`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPartners.map((partner) => {
            const isProcessing = actionLoadingId === partner.id;
            return (
              <div
                key={partner.id}
                className="bg-white rounded-[16px] border border-[#EEF2F6] p-5 shadow-2xs flex flex-col justify-between hover:border-[#111111]/40 transition-colors"
              >
                <div>
                  {/* Top Bar: Name & Verification Status Badge */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-base font-bold text-[#0F172A]">
                        {partner.name}
                      </h4>
                      <div className="flex items-center gap-1.5 text-xs text-[#475569] mt-0.5">
                        <Phone className="w-3.5 h-3.5 text-[#64748B]" />
                        <span>{partner.phone}</span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-[6px] text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${
                        partner.verification_status === 'verified'
                          ? 'bg-[#D1FAE5] text-[#065F46]'
                          : partner.verification_status === 'rejected'
                          ? 'bg-[#FEE2E2] text-[#991B1B]'
                          : 'bg-[#FEF3C7] text-[#92400E]'
                      }`}
                    >
                      {partner.verification_status === 'verified' && <CheckCircle2 className="w-3 h-3" />}
                      {partner.verification_status === 'rejected' && <XCircle className="w-3 h-3" />}
                      {partner.verification_status === 'pending' && <Clock className="w-3 h-3" />}
                      {partner.verification_status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-3 bg-[#FFFFFF] rounded-[10px] border border-[#EEF2F6]/70 text-xs mb-3">
                    <div>
                      <span className="text-xs uppercase font-bold text-[#64748B] block">Rating</span>
                      <span className="font-semibold text-[#0F172A] flex items-center gap-1 mt-0.5">
                        <Star className="w-3 h-3 text-[#111111]" />
                        {partner.rating_count ? `${Number(partner.rating_avg).toFixed(1)} (${partner.rating_count})` : 'No ratings yet'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs uppercase font-bold text-[#64748B] block">Availability</span>
                      <span className="font-semibold text-[#0F172A] mt-0.5 block">
                        {partner.is_available ? 'On shift' : 'Off shift'}
                      </span>
                    </div>
                  </div>

                  {partner.verification_note && (
                    <p className="mb-4 text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] p-2.5">
                      <span className="font-bold">Reason: </span>
                      {partner.verification_note}
                    </p>
                  )}
                </div>

                {/* Bottom Action Strip - reject lives in Review so a reason is always collected */}
                <div className="pt-3 border-t border-[#EEF2F6] flex items-center justify-between gap-2">
                  <span className="text-xs text-[#64748B]">
                    ID: {partner.id.slice(0, 8)}…
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => openReview(partner.id)}
                      className="px-3 py-1.5 rounded-[8px] border border-[#111111] text-[#111111] hover:bg-[#F1F2F4] text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Review</span>
                    </button>
                    {partner.verification_status !== 'verified' && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUpdateStatus(partner.id, 'verified')}
                        className="px-3 py-1.5 rounded-[8px] bg-[#111111] hover:bg-[#0D655E] text-white text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                    )}
                    {partner.verification_status !== 'pending' && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUpdateStatus(partner.id, 'pending')}
                        className="px-2.5 py-1.5 rounded-[8px] border border-[#EEF2F6] bg-white hover:bg-[#F6F8FA] text-[#475569] text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={reviewId !== null}
        onClose={closeReview}
        title="Verification review"
        description="Check documents and equipment before deciding."
        maxWidth="lg"
      >
        {detailError ? (
          <p className="text-xs text-[#991B1B]">{detailError}</p>
        ) : !detail ? (
          <p className="text-xs text-[#475569]">Loading…</p>
        ) : (
          <div className="space-y-4 text-xs text-[#0F172A]">
            <div>
              <h4 className="text-base font-bold">{detail.name ?? 'Unnamed partner'}</h4>
              <p className="text-[#475569]">
                {detail.phone} · status: {detail.verification_status}
              </p>
              {detail.verification_note && (
                <p className="mt-2 text-[#991B1B]">
                  <span className="font-bold">Reason: </span>
                  {detail.verification_note}
                </p>
              )}
            </div>

            <section>
              <h5 className="text-xs uppercase font-bold text-[#64748B] mb-1.5 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Documents ({detail.documents.length})
              </h5>
              {detail.documents.length === 0 ? (
                <p className="text-[#475569]">No documents uploaded — nothing to verify yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.documents.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-[8px] border border-[#EEF2F6]"
                    >
                      <span className="font-semibold capitalize">{label(d.doc_type)}</span>
                      <span className="text-[#475569]">
                        {d.has_file ? 'file on record' : 'no file uploaded'}
                        {d.expiry_date ? ` · expires ${d.expiry_date}` : ''} · {d.status}
                        {d.rejection_reason ? ` (${d.rejection_reason})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h5 className="text-xs uppercase font-bold text-[#64748B] mb-1.5 flex items-center gap-1">
                <Truck className="w-3 h-3" /> Equipment ({detail.equipment.length})
              </h5>
              {detail.equipment.length === 0 ? (
                <p className="text-[#475569]">No equipment registered.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.equipment.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-[8px] border border-[#EEF2F6]"
                    >
                      <span className="font-semibold capitalize">{label(e.equipment_type)}</span>
                      <span className="text-[#475569]">
                        {e.registration_number ?? 'no registration'} · {e.verification_status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {rejecting && (
              <div className="space-y-2">
                <label htmlFor="reject-reason" className="font-semibold block">
                  Reason for rejection (required)
                </label>
                <textarea
                  id="reject-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full p-2 rounded-[8px] border border-[#EEF2F6] focus:outline-none focus:border-[#B91C1C]"
                  placeholder="e.g. Driving licence expired"
                />
              </div>
            )}

            {actionError && (
              <p role="alert" className="text-[#991B1B] font-semibold">
                {actionError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EEF2F6]">
              {rejecting ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRejecting(false);
                      setActionError(null);
                    }}
                    className="px-3 py-2 rounded-[8px] border border-[#EEF2F6] font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={actionLoadingId === detail.id}
                    onClick={submitReject}
                    className="px-3 py-2 rounded-[8px] bg-[#B91C1C] text-white font-semibold flex items-center gap-1 disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Confirm rejection
                  </button>
                </>
              ) : (
                <>
                  {detail.verification_status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRejecting(true);
                        setActionError(null);
                      }}
                      className="px-3 py-2 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] font-semibold flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject…
                    </button>
                  )}
                  {detail.verification_status !== 'verified' && (
                    <button
                      type="button"
                      disabled={actionLoadingId === detail.id}
                      onClick={() => handleUpdateStatus(detail.id, 'verified')}
                      className="px-3 py-2 rounded-[8px] bg-[#111111] text-white font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
