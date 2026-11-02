import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import supabase from '@/services/supabase'
import type { Business, Membership, UserRole } from '@/types'

interface AuthContextType {
  user: User | null
  session: Session | null
  membership: Membership | null
  memberships: Membership[]
  business: Business | null
  role: UserRole | null
  isOwner: boolean
  isStaff: boolean
  hasMultipleMemberships: boolean
  membershipError: string | null
  loading: boolean
  signIn: (email: string, pass: string) => Promise<{ error: Error | null; role?: UserRole | null }>
  signOut: () => Promise<void>
  refreshMembership: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [membershipError, setMembershipError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const clearMembershipState = () => {
    setMembership(null)
    setMemberships([])
    setBusiness(null)
    setMembershipError(null)
  }

  const loadMembership = async (userId: string): Promise<UserRole | null> => {
    try {
      const { data: memberRows, error: memberErr } = await supabase
        .from('memberships')
        .select('*, business:businesses(*)')
        .eq('user_id', userId)
        .order('business_id', { ascending: true })

      if (memberErr) {
        setMembership(null)
        setMemberships([])
        setBusiness(null)
        setMembershipError(memberErr.message || 'Unable to verify business membership.')
        return null
      }

      const rows = (memberRows || []) as Membership[]
      setMemberships(rows)

      if (rows.length === 0) {
        setMembership(null)
        setBusiness(null)
        setMembershipError('No business membership found for this account.')
        return null
      }

      // Consistent with database public.current_business_id(), which returns NULL when COUNT(*) <> 1
      if (rows.length > 1) {
        setMembership(null)
        setBusiness(null)
        setMembershipError(
          'Multiple business memberships detected for this account. Ambiguous tenant selection is not permitted; please ensure a single active business membership.'
        )
        return null
      }

      const activeMembership = rows[0]
      setMembership(activeMembership)
      setBusiness((activeMembership.business as Business) ?? null)
      setMembershipError(null)
      return activeMembership.role
    } catch (err: any) {
      console.warn('Could not load membership:', err)
      setMembership(null)
      setMemberships([])
      setBusiness(null)
      setMembershipError(err?.message || 'Unable to load business membership.')
      return null
    }
  }

  useEffect(() => {
    // Initial session retrieval
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadMembership(session.user.id).finally(() => setLoading(false))
      } else {
        clearMembershipState()
        setLoading(false)
      }
    })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      if (newSession?.user) {
        await loadMembership(newSession.user.id)
      } else {
        clearMembershipState()
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pass,
    })

    if (error) {
      return { error: new Error(error.message), role: null }
    }

    let resolvedRole: UserRole | null = null
    if (data.user) {
      resolvedRole = await loadMembership(data.user.id)
    }

    return { error: null, role: resolvedRole }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    clearMembershipState()
  }

  const refreshMembership = async () => {
    if (user) {
      await loadMembership(user.id)
    }
  }

  const hasMultipleMemberships = memberships.length > 1
  const role: UserRole | null = membership?.role || null
  const isOwner = role === 'owner' && !hasMultipleMemberships
  const isStaff = (role === 'staff' || role === 'owner') && !hasMultipleMemberships

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        membership,
        memberships,
        business,
        role,
        isOwner,
        isStaff,
        hasMultipleMemberships,
        membershipError,
        loading,
        signIn,
        signOut,
        refreshMembership,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
