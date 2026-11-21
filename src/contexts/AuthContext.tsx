import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import supabase, { getActiveBusinessId, setActiveBusinessId } from '@/services/supabase'
import type { Branch, Business, FinancialYear, Membership, UserRole } from '@/types'

interface AuthContextType {
  user: User | null
  session: Session | null
  membership: Membership | null
  memberships: Membership[]
  business: Business | null
  branches: Branch[]
  activeBranch: Branch | null
  financialYears: FinancialYear[]
  activeFY: FinancialYear | null
  role: UserRole | null
  isOwner: boolean
  isStaff: boolean
  hasMultipleMemberships: boolean
  membershipError: string | null
  loading: boolean
  signIn: (email: string, pass: string) => Promise<{ error: Error | null; role?: UserRole | null }>
  signUp: (email: string, pass: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  refreshMembership: () => Promise<void>
  switchBusiness: (businessId: number) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null)
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([])
  const [activeFY, setActiveFY] = useState<FinancialYear | null>(null)
  const [membershipError, setMembershipError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const inFlightRef = useRef<{ userId: string; promise: Promise<UserRole | null> } | null>(null)

  const clearMembershipState = () => {
    setActiveBusinessId(null)
    setMembership(null)
    setMemberships([])
    setBusiness(null)
    setBranches([])
    setActiveBranch(null)
    setFinancialYears([])
    setActiveFY(null)
    setMembershipError(null)
  }

  const loadCoreContext = async (activeBusinessId: number, currentRequestId: number) => {
    try {
      const [branchRes, fyRes] = await Promise.all([
        supabase
          .from('branches')
          .select('*')
          .eq('business_id', activeBusinessId)
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
        supabase
          .from('financial_years')
          .select('*')
          .eq('business_id', activeBusinessId)
          .order('start_date', { ascending: false }),
      ])

      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return

      if (!branchRes.error && Array.isArray(branchRes.data)) {
        const branchList = branchRes.data as Branch[]
        setBranches(branchList)
        setActiveBranch(branchList.find((b) => b.is_default) || branchList[0] || null)
      } else {
        setBranches([])
        setActiveBranch(null)
      }

      if (!fyRes.error && Array.isArray(fyRes.data)) {
        const fyList = fyRes.data as FinancialYear[]
        setFinancialYears(fyList)
        setActiveFY(fyList.find((f) => f.is_active) || fyList[0] || null)
      } else {
        setFinancialYears([])
        setActiveFY(null)
      }
    } catch {
      // Stage 1 tables may not be migrated yet in older environments; fail gracefully
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return
      setBranches([])
      setActiveBranch(null)
      setFinancialYears([])
      setActiveFY(null)
    }
  }

  const loadMembership = async (userId: string, preferredBusinessId?: number): Promise<UserRole | null> => {
    if (!preferredBusinessId && inFlightRef.current && inFlightRef.current.userId === userId) {
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
          clearMembershipState()
          setMembershipError(memberErr.message || 'Unable to verify business membership.')
          return null
        }

        const rows = (memberRows || []) as Membership[]
        setMemberships(rows)

        if (rows.length === 0) {
          setActiveBusinessId(null)
          setMembership(null)
          setBusiness(null)
          setBranches([])
          setActiveBranch(null)
          setFinancialYears([])
          setActiveFY(null)
          setMembershipError('No business membership found for this account.')
          return null
        }

        // Resolve tab-scoped active company: explicit preference -> sessionStorage -> first membership
        const desiredId = preferredBusinessId ?? getActiveBusinessId()
        const activeMembership =
          (desiredId !== null ? rows.find((r) => r.business_id === desiredId) : undefined) || rows[0]

        setActiveBusinessId(activeMembership.business_id)
        setMembership(activeMembership)
        setBusiness((activeMembership.business as Business) ?? null)
        setMembershipError(null)

        await loadCoreContext(activeMembership.business_id, currentRequestId)
        return activeMembership.role
      } catch (err: any) {
        if (!mountedRef.current || currentRequestId !== requestIdRef.current) {
          return null
        }
        console.warn('Could not load membership:', err)
        clearMembershipState()
        setMembershipError(err?.message || 'Unable to load business membership.')
        return null
      } finally {
        if (inFlightRef.current?.userId === userId) {
          inFlightRef.current = null
        }
      }
    })()

    if (!preferredBusinessId) {
      inFlightRef.current = { userId, promise }
    }
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

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!initialResolved) {
        initialResolved = true
        void syncSessionState(initialSession)
      }
    })

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

  const signUp = async (email: string, pass: string) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pass,
    })

    if (error) {
      if (mountedRef.current) {
        setLoading(false)
      }
      return { error: new Error(error.message), needsEmailConfirmation: false }
    }

    const needsEmailConfirmation = Boolean(data.user && !data.session)

    if (data.session && data.user && mountedRef.current) {
      setSession(data.session)
      setUser(data.user)
      await loadMembership(data.user.id)
    }

    if (mountedRef.current) {
      setLoading(false)
    }

    return { error: null, needsEmailConfirmation }
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

  const switchBusiness = async (businessId: number) => {
    if (!user) return
    setLoading(true)
    await loadMembership(user.id, businessId)
    if (mountedRef.current) {
      setLoading(false)
    }
  }

  const hasMultipleMemberships = memberships.length > 1
  const role: UserRole | null = membership?.role || null
  const isOwner = role === 'owner'
  const isStaff = role === 'staff' || role === 'owner'

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        membership,
        memberships,
        business,
        branches,
        activeBranch,
        financialYears,
        activeFY,
        role,
        isOwner,
        isStaff,
        hasMultipleMemberships,
        membershipError,
        loading,
        signIn,
        signUp,
        signOut,
        refreshMembership,
        switchBusiness,
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
