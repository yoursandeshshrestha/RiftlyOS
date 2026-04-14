export interface Deal {
  id: string
  prospect_name: string
  services: string
  deal_value: number
  stage: 'lead' | 'proposal_sent' | 'negotiation' | 'closed_won' | 'closed_lost'
  next_action: string | null
  position: number
  closed_date: string | null
  created_at: string
}

export const STAGES = [
  { id: 'lead', label: 'Lead' },
  { id: 'proposal_sent', label: 'Proposal Sent' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'closed_won', label: 'Closed Won' },
  { id: 'closed_lost', label: 'Closed Lost' },
] as const
