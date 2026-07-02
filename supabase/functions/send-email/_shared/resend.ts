import { Resend } from 'npm:resend@4.0.0'

export interface SendViaResendInput {
  to: string
  subject: string
  html: string
}

export interface SendViaResendResult {
  id: string | null
  skipped: boolean
}

export async function sendViaResend(input: SendViaResendInput): Promise<SendViaResendResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Agency OS <onboarding@resend.dev>'

  if (!apiKey) {
    console.warn('[send-email] RESEND_API_KEY not set — skipping send', {
      to: input.to,
      subject: input.subject,
    })
    return { id: null, skipped: true }
  }

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  })

  if (error) {
    throw new Error(error.message)
  }

  return { id: data?.id ?? null, skipped: false }
}
