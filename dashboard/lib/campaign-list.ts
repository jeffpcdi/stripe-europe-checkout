import type { AdsTreeCampaign } from './types'

// A aprovação é uma dimensão independente do estado de entrega.
export function campaignMatchesStatus(campaign: AdsTreeCampaign, status: string) {
  return !status || (status === 'approved' ? campaign.reviewStatus === 'approved' : campaign.status === status)
}

export function campaignStatusCounts(campaigns: AdsTreeCampaign[]) {
  const counts: Record<string, number> = { all: campaigns.length, approved: 0 }
  for (const campaign of campaigns) {
    if (campaign.status) counts[campaign.status] = (counts[campaign.status] || 0) + 1
    if (campaign.reviewStatus === 'approved') counts.approved++
  }
  return counts
}
