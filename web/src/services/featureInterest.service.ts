import { apiClient } from './api';

// ADR-035: "notify me" on features that are announced but not built. Owners
// and partners each have their own list; the backend picks it from the token.
export type OwnerComingSoon = 'scheduled' | 'doorstep' | 'pickup-drop';
export type PartnerComingSoon = 'financing' | 'certification' | 'custody-tier';
export type ComingSoonFeature = OwnerComingSoon | PartnerComingSoon;

export const featureInterestService = {
  async listMine(): Promise<ComingSoonFeature[]> {
    const res = await apiClient<{ features: ComingSoonFeature[] }>('/feature-interest/me', { method: 'GET' });
    return res.data.features;
  },

  async register(feature: ComingSoonFeature): Promise<ComingSoonFeature[]> {
    const res = await apiClient<{ features: ComingSoonFeature[] }>('/feature-interest', {
      method: 'POST',
      body: JSON.stringify({ feature }),
    });
    return res.data.features;
  },
};
