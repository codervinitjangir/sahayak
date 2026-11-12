import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Wrench,
  Phone,
  Building,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

import {
  adminService,
  AdminPartnerSummary,
} from '../../services/admin.service';

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected';

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
      setPartners(res.partners);
    } catch (err: any) {
      setError(err?.message || 'Could not load partner list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPartners(statusFilter);
  }, [statusFilter]);

  const handleUpdateStatus = async (
    partnerId: string,
    newStatus: 'verified' | 'rejected' | 'pending'
  ) => {
    setActionLoadingId(partnerId);
    try {
      const updated = await adminService.verifyPartner(partnerId, newStatus);
      setPartners((prev) =>
        prev.map((p) => (p.id === partnerId ? { ...p, verification_status: updated.verification_status } : p))
      );
    } catch (err: any) {
      alert(`Failed to update status: ${err?.message || 'Network error'}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredPartners = partners.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.phone.toLowerCase().includes(q) ||
      (p.workshop_name && p.workshop_name.toLowerCase().includes(q))
    );
  });

  const pendingCount = partners.filter((p) => p.verification_status === 'pending').length;
  const verifiedCount = partners.filter((p) => p.verification_status === 'verified').length;
  const rejectedCount = partners.filter((p) => p.verification_status === 'rejected').length;

  return (
    <div className="space-y-6">
      {/* ── Section Title & Filter Controls ── */}
      <div className="bg-white rounded-[16px] border border-[#E7E0D2] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0F766E]" />
              <h2 className="font-['Fraunces'] text-lg font-bold text-[#1B1712]">
                Mechanic & Workshop Verification
              </h2>
            </div>
            <p className="text-xs text-[#5B5346] mt-1">
              Review incoming partner registrations, inspect workshop credentials, and grant dispatch eligibility.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchPartners(statusFilter)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[8px] border border-[#E7E0D2] bg-white hover:bg-[#F6F1E6] text-[#1B1712] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#0F766E] ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="mt-4 pt-4 border-t border-[#E7E0D2] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-[#9A917F] uppercase tracking-wider mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Status:
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition-all ${
                statusFilter === 'all'
                  ? 'bg-[#1B1712] text-white shadow-2xs'
                  : 'text-[#5B5346] hover:bg-[#F6F1E6]'
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
                  ? 'bg-[#0F766E] text-white shadow-2xs'
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
            <Search className="w-3.5 h-3.5 text-[#9A917F] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search partner, phone, workshop..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-8 pr-3 py-1.5 text-xs rounded-[8px] border border-[#E7E0D2] bg-white text-[#1B1712] focus:outline-none focus:border-[#0F766E]"
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
          <RefreshCw className="w-6 h-6 text-[#0F766E] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#5B5346]">Loading partners from database…</p>
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="bg-white rounded-[16px] border border-[#E7E0D2] p-12 text-center shadow-2xs">
          <ShieldCheck className="w-10 h-10 text-[#9A917F] mx-auto mb-3 opacity-60" />
          <h3 className="font-['Fraunces'] text-base font-bold text-[#1B1712]">No Partners Found</h3>
          <p className="text-xs text-[#5B5346] mt-1 max-w-sm mx-auto">
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
                className="bg-white rounded-[16px] border border-[#E7E0D2] p-5 shadow-2xs flex flex-col justify-between hover:border-[#0F766E]/40 transition-colors"
              >
                <div>
                  {/* Top Bar: Name & Verification Status Badge */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="font-['Fraunces'] text-base font-bold text-[#1B1712]">
                        {partner.name}
                      </h4>
                      <div className="flex items-center gap-1.5 text-xs text-[#5B5346] mt-0.5">
                        <Phone className="w-3.5 h-3.5 text-[#9A917F]" />
                        <span>{partner.phone}</span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-[6px] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
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

                  {/* Details Strip: Workshop & Experience */}
                  <div className="grid grid-cols-2 gap-2 p-3 bg-[#FBF8F1] rounded-[10px] border border-[#E7E0D2]/70 text-xs mb-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#9A917F] block">Workshop</span>
                      <span className="font-semibold text-[#1B1712] truncate flex items-center gap-1 mt-0.5">
                        <Building className="w-3 h-3 text-[#0F766E]" />
                        {partner.workshop_name || 'Independent Mobile'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#9A917F] block">Experience</span>
                      <span className="font-semibold text-[#1B1712] flex items-center gap-1 mt-0.5">
                        <Wrench className="w-3 h-3 text-[#0F766E]" />
                        {partner.experience_years} years on-field
                      </span>
                    </div>
                  </div>

                  {/* Capabilities Tags */}
                  <div className="mb-4">
                    <span className="text-[10px] uppercase font-bold text-[#9A917F] block mb-1.5">
                      Service Capabilities
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {partner.services && partner.services.length > 0 ? (
                        partner.services.map((svc) => (
                          <span
                            key={svc}
                            className="px-2 py-0.5 rounded-[4px] bg-[#E7E0D2]/50 text-[#5B5346] text-[11px] font-medium"
                          >
                            {svc}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-[#9A917F]">General Mechanical</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Action Strip */}
                <div className="pt-3 border-t border-[#E7E0D2] flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#9A917F]">
                    ID: {partner.id.slice(0, 8)}…
                  </span>

                  <div className="flex items-center gap-2">
                    {partner.verification_status !== 'verified' && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUpdateStatus(partner.id, 'verified')}
                        className="px-3 py-1.5 rounded-[8px] bg-[#0F766E] hover:bg-[#0D655E] text-white text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                    )}
                    {partner.verification_status !== 'rejected' && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUpdateStatus(partner.id, 'rejected')}
                        className="px-3 py-1.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#B91C1C] text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    )}
                    {partner.verification_status !== 'pending' && (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleUpdateStatus(partner.id, 'pending')}
                        className="px-2.5 py-1.5 rounded-[8px] border border-[#E7E0D2] bg-white hover:bg-[#F6F1E6] text-[#5B5346] text-xs font-semibold transition-colors disabled:opacity-50"
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
    </div>
  );
};
