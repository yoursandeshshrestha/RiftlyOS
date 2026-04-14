export interface RevenueTarget {
  id: string
  workspace_id: string
  month: string // First day of month (YYYY-MM-DD)
  target_amount: number
  created_at: string
  updated_at: string
}

export interface RevenueEntry {
  id: string
  workspace_id: string
  amount: number
  description: string
  entry_date: string // YYYY-MM-DD
  category: 'service_income' | 'project_income' | 'other'
  created_by: string
  created_at: string
  updated_at: string
}

export interface RevenueMetrics {
  totalMRR: number
  projectIncome: number
  otherIncome: number
  totalRevenue: number
  targetAmount: number
  progressPercentage: number
  breakdown?: {
    servicesMRR: number
    serviceIncomeEntries: number
    dealsIncome: number
    projectIncomeEntries: number
    otherIncomeEntries: number
  }
  comparison?: {
    totalRevenue: {
      prevValue: number
      currentValue: number
      changePercentage: number
    }
    mrr: {
      prevValue: number
      currentValue: number
      changePercentage: number
    }
    projectIncome: {
      prevValue: number
      currentValue: number
      changePercentage: number
    }
    otherIncome: {
      prevValue: number
      currentValue: number
      changePercentage: number
    }
  }
}

export interface RevenueBreakdownItem {
  id: string
  source: 'service' | 'deal' | 'manual'
  name: string
  amount: number
  date: string
  description?: string
}

export const REVENUE_CATEGORIES = [
  { id: 'service_income', label: 'Service Income' },
  { id: 'project_income', label: 'Project Income' },
  { id: 'other', label: 'Other Income' },
] as const
