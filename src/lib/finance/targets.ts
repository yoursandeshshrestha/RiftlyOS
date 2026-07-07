import { supabase } from '../supabase'

export async function saveRevenueTarget(
  workspaceId: string,
  period: string,
  amountMajor: number,
): Promise<void> {
  const { error } = await supabase.from('revenue_targets').upsert(
    {
      workspace_id: workspaceId,
      month: period,
      target_amount: amountMajor,
    },
    { onConflict: 'workspace_id,month' },
  )

  if (error) throw error
}
