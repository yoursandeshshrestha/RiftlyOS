import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from './_shared/cors.ts'
import { processQueuedEmail, retryQueuedEmail } from './_shared/process.ts'
import type { EmailRequestBody, EmailTemplateId, RetryEmailRequest, SendEmailRequest } from './_shared/types.ts'
import { isValidTemplateId, renderEmailTemplate } from './templates/index.ts'

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void
}

interface QueueRow {
  id: string
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase environment configuration')
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function resolveActor(
  authHeader: string | null,
): Promise<{ userId: string | null; isServiceRole: boolean }> {
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }

  const token = authHeader.replace('Bearer ', '')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (serviceRoleKey && token === serviceRoleKey) {
    return { userId: null, isServiceRole: true }
  }

  const supabaseKey =
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseKey) {
    throw new Error('Missing Supabase anon key')
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', supabaseKey)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new Error('Invalid user token')
  }

  return { userId: user.id, isServiceRole: false }
}

async function assertWorkspaceMember(
  admin: ReturnType<typeof getSupabaseAdmin>,
  workspaceId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    throw new Error('You do not have access to this workspace')
  }

  return data.role as string
}

async function assertWorkspaceOwner(
  admin: ReturnType<typeof getSupabaseAdmin>,
  workspaceId: string,
  userId: string,
) {
  const role = await assertWorkspaceMember(admin, workspaceId, userId)
  if (role !== 'owner') {
    throw new Error('Only workspace owners can retry email deliveries')
  }
}

function isRetryRequest(body: EmailRequestBody): body is RetryEmailRequest {
  return body.action === 'retry'
}

function isSendRequest(body: EmailRequestBody): body is SendEmailRequest {
  return body.action !== 'retry'
}

function runInBackground(promise: Promise<unknown>) {
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(promise)
  } else {
    void promise
  }
}

async function handleSend(body: SendEmailRequest, userId: string | null, isServiceRole: boolean) {
  const { template, to, payload, workspaceId } = body

  if (!template || !isValidTemplateId(template)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing template' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!to || !isValidEmail(to)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing recipient email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!payload || typeof payload !== 'object') {
    return new Response(JSON.stringify({ error: 'Invalid or missing payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = getSupabaseAdmin()

  if (!isServiceRole) {
    if (!userId) {
      throw new Error('Unauthorized')
    }
    if (workspaceId) {
      if (template === 'test-email') {
        await assertWorkspaceOwner(admin, workspaceId, userId)
      } else {
        await assertWorkspaceMember(admin, workspaceId, userId)
      }
    } else if (template === 'test-email') {
      throw new Error('workspaceId is required for test emails')
    }
  }

  renderEmailTemplate(template, payload)

  const { data: queued, error: queueError } = await admin
    .from('email_queue')
    .insert({
      workspace_id: workspaceId ?? null,
      template,
      recipient: to,
      payload,
      status: 'pending',
      created_by: userId,
    })
    .select('id')
    .single()

  if (queueError || !queued) {
    throw new Error(queueError?.message ?? 'Failed to queue email')
  }

  const emailId = (queued as QueueRow).id
  runInBackground(processQueuedEmail(admin, emailId))

  return new Response(
    JSON.stringify({ queued: true, emailId, status: 'pending' }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

async function handleRetry(body: RetryEmailRequest, userId: string | null, isServiceRole: boolean) {
  const { emailId, workspaceId } = body

  if (!emailId || !workspaceId) {
    return new Response(JSON.stringify({ error: 'emailId and workspaceId are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isServiceRole) {
    if (!userId) {
      throw new Error('Unauthorized')
    }
    const admin = getSupabaseAdmin()
    await assertWorkspaceOwner(admin, workspaceId, userId)
  }

  const admin = getSupabaseAdmin()
  const { emailId: retriedId } = await retryQueuedEmail(admin, emailId, workspaceId)
  runInBackground(processQueuedEmail(admin, retriedId))

  return new Response(
    JSON.stringify({ queued: true, emailId: retriedId, status: 'pending', retried: true }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await req.json()) as EmailRequestBody
    const { userId, isServiceRole } = await resolveActor(req.headers.get('Authorization'))

    if (isRetryRequest(body)) {
      return await handleRetry(body, userId, isServiceRole)
    }

    if (isSendRequest(body)) {
      return await handleSend(body, userId, isServiceRole)
    }

    return new Response(JSON.stringify({ error: 'Invalid request action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status =
      message.includes('token') ||
        message.includes('Unauthorized') ||
        message.includes('access') ||
        message.includes('owners')
        ? 401
        : 400

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
