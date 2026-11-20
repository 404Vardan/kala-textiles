import supabase from './supabase'
import type { UserRole } from '@/types'

export interface TeamMember {
  user_id: string
  business_id: number
  email: string
  role: UserRole
  created_at: string
  email_confirmed_at?: string | null
}

export interface InviteTeamMemberResult {
  success: boolean
  user_id: string
  email: string
  role: UserRole
  invited: boolean
}

export async function listBusinessMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('list_business_members')
  if (error) {
    throw new Error(error.message || 'Failed to load team members.')
  }
  return (data || []) as TeamMember[]
}

export async function inviteTeamMember(
  email: string,
  role: UserRole = 'staff'
): Promise<InviteTeamMemberResult> {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined

  const { data, error } = await supabase.functions.invoke('invite-team-member', {
    body: {
      email: email.trim().toLowerCase(),
      role,
      redirectTo,
    },
  })

  if (error) {
    // Extract error message from Edge Function response if present
    let msg = error.message || 'Failed to invite team member.'
    try {
      const ctx = (error as any).context
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json()
        if (parsed?.error) msg = parsed.error
      }
    } catch {
      // Fall back to default message
    }
    throw new Error(msg)
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error))
  }

  return data as InviteTeamMemberResult
}

export async function updateMemberRole(userId: string, newRole: UserRole): Promise<void> {
  const { error } = await supabase.rpc('update_member_role', {
    p_user_id: userId,
    p_new_role: newRole,
  })
  if (error) {
    throw new Error(error.message || 'Failed to update member role.')
  }
}

export async function removeBusinessMember(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_business_member', {
    p_user_id: userId,
  })
  if (error) {
    throw new Error(error.message || 'Failed to remove team member.')
  }
}
