import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-business-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization header' }, 401)
    }

    // 1. Verify caller JWT using anon client with caller's Authorization header
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser()

    if (callerError || !caller) {
      return jsonResponse({ error: 'Invalid or expired session' }, 401)
    }

    // 2. Create server-only service role admin client
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 3. Resolve active business from x-business-id header (with single-company fallback)
    const { data: callerMemberships, error: membershipErr } = await adminClient
      .from('memberships')
      .select('business_id, role')
      .eq('user_id', caller.id)

    if (membershipErr || !callerMemberships || callerMemberships.length === 0) {
      return jsonResponse({ error: 'No business membership found for caller' }, 403)
    }

    const rawHeaderBiz = (req.headers.get('x-business-id') || '').trim()
    let targetBusinessId: number | null = null

    if (rawHeaderBiz) {
      if (!/^[0-9]+$/.test(rawHeaderBiz)) {
        return jsonResponse({ error: 'Invalid x-business-id header' }, 400)
      }
      targetBusinessId = Number(rawHeaderBiz)
    } else if (callerMemberships.length === 1) {
      targetBusinessId = callerMemberships[0].business_id
    } else {
      return jsonResponse(
        { error: 'x-business-id header is required for multi-company accounts' },
        400
      )
    }

    const callerMembership = callerMemberships.find((m) => m.business_id === targetBusinessId)
    if (!callerMembership || callerMembership.role !== 'owner') {
      return jsonResponse({ error: 'Only business owners can invite team members' }, 403)
    }

    const businessId = callerMembership.business_id

    // 4. Parse and validate payload
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const rawEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    const rawRole = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : 'staff'
    const redirectTo = typeof payload.redirectTo === 'string' && payload.redirectTo.trim()
      ? payload.redirectTo.trim()
      : undefined

    if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return jsonResponse({ error: 'Please provide a valid email address.' }, 400)
    }

    if (rawRole !== 'owner' && rawRole !== 'staff') {
      return jsonResponse({ error: 'Role must be either "owner" or "staff".' }, 400)
    }

    // 5. Invite user via Supabase Auth Admin API (server-side service role only)
    let targetUserId: string | null = null
    let invited = false

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      rawEmail,
      redirectTo ? { redirectTo } : undefined
    )

    if (!inviteError && inviteData?.user) {
      targetUserId = inviteData.user.id
      invited = true
    } else {
      const { data: listed, error: listErr } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      if (listErr) {
        return jsonResponse(
          { error: inviteError?.message || 'Unable to invite user' },
          400
        )
      }

      const existingUser = listed.users.find(
        (u) => (u.email || '').toLowerCase() === rawEmail
      )

      if (!existingUser) {
        return jsonResponse(
          { error: inviteError?.message || 'Unable to invite user' },
          400
        )
      }

      targetUserId = existingUser.id
      invited = false
    }

    // 6. Prevent duplicate membership in the target business (multi-company users are allowed)
    const { data: existingInBiz, error: existingMemErr } = await adminClient
      .from('memberships')
      .select('business_id')
      .eq('user_id', targetUserId)
      .eq('business_id', businessId)
      .maybeSingle()

    if (existingMemErr) {
      return jsonResponse({ error: 'Failed to verify target user membership' }, 500)
    }

    if (existingInBiz) {
      return jsonResponse({ error: 'This user is already a member of this business.' }, 409)
    }

    // 7. Resolve matching system role_id (Owner or Sales Staff) for the target business
    const systemRoleName = rawRole === 'owner' ? 'Owner' : 'Sales Staff'
    const { data: roleRow } = await adminClient
      .from('roles')
      .select('id')
      .eq('business_id', businessId)
      .eq('name', systemRoleName)
      .maybeSingle()

    // 8. Insert membership row with consistent role_id
    const membershipRow: Record<string, unknown> = {
      user_id: targetUserId,
      business_id: businessId,
      role: rawRole,
    }
    if (roleRow?.id) {
      membershipRow.role_id = roleRow.id
    }

    const { error: insertErr } = await adminClient
      .from('memberships')
      .insert(membershipRow)

    if (insertErr) {
      return jsonResponse({ error: insertErr.message || 'Failed to add member to business' }, 500)
    }

    return jsonResponse({
      success: true,
      user_id: targetUserId,
      business_id: businessId,
      email: rawEmail,
      role: rawRole,
      role_id: roleRow?.id ?? null,
      invited,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    return jsonResponse({ error: message }, 500)
  }
})
