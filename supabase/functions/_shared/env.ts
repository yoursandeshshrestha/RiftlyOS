/**
 * Typed environment variable access for Edge Functions.
 * Fails fast if required variables are missing.
 */

function required(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  STRIPE_SECRET_KEY: () => required('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: () => required('STRIPE_WEBHOOK_SECRET'),
  SUPABASE_URL: () => required('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  RESEND_API_KEY: () => Deno.env.get('RESEND_API_KEY') ?? '',
} as const
