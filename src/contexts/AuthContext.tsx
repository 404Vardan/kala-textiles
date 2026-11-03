import { createContext, useContext, useEffect, useRef, useState } from 'react'
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

  // Monotonic sequence & in-flight deduplication to prevent auth/membership race conditions
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const inFlightRef = useRef<{ userId: string; promise: Promise<UserRole | null> } | null>(null)

  const clearMembershipState = () => {
    setMembership(null)
    setMemberships([])
    setBusiness(null)
    setMembershipError(null)
  }

  const loadMembership = async (userId: string): Promise<UserRole | null> => {
    // Reuse in-flight request if already fetching for the exact same userId
    if (inFlightRef.current && inFlightRef.current.userId === userId) {
      return inFlightRef.current.promise
    }

    const currentRequestId = ++requestIdRef.current

    const promise = (async (): Promise<UserRole | null> => {
      try {
        const { data: memberRows, error: memberErr } = await supabase
          .from('memberships')
          .select('*, business:businesses(*)')
          .eq('user_id', userId)
          .order('business_id', { ascending: true })

        if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
          return null
        }

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
        if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
          return null
        }
        console.warn('Could not load membership:', err)
        setMembership(null)
        setMemberships([])
        setBusiness(null)
        setMembershipError(err?.message || 'Unable to load business membership.')
        return null
      } finally {
        if (inFlightRef.current?.userId === userId) {
          inFlightRef.current = null
        }
      }
    })()

    inFlightRef.current = { userId, promise }
    return promise
  }

  useEffect(() => {
    mountedRef.current = true
    let initialResolved = false

    const syncSessionState = async (nextSession: Session | null) => {
      if (!mountedRef.current) return

      setSession(nextSession)
      const nextUser = nextSession?.user ?? null
      setUser(nextUser)

      if (nextUser) {
        setLoading(true)
        await loadMembership(nextUser.id)
      } else {
        requestIdRef.current += 1
        inFlightRef.current = null
        clearMembershipState()
      }

      if (mountedRef.current) {
        setLoading(false)
      }
    }

    // Initial session retrieval
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!initialResolved) {
        initialResolved = true
        void syncSessionState(initialSession)
      }
    })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      initialResolved = true
      void syncSessionState(newSession)
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, pass: string) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pass,
    })

    if (error) {
      if (mountedRef.current) {
        setLoading(false)
      }
      return { error: new Error(error.message), role: null }
    }

    let resolvedRole: UserRole | null = null
    if (data.user) {
      setSession(data.session)
      setUser(data.user)
      resolvedRole = await loadMembership(data.user.id)
    }

    if (mountedRef.current) {
      setLoading(false)
    }

    return { error: null, role: resolvedRole }
  }

  const signOut = async () => {
    requestIdRef.current += 1
    inFlightRef.current = null
    await supabase.auth.signOut()
    if (!mountedRef.current) return
    setSession(null)
    setUser(null)
    clearMembershipState()
    setLoading(false)
  }

  const refreshMembership = async () => {
    if (user) {
      setLoading(true)
      await loadMembership(user.id)
      if (mountedRef.current) {
        setLoading(false)
      }
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
