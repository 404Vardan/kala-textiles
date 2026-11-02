import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import supabase from '@/services/supabase'
import type { Business, Membership, UserRole } from '@/types'

interface AuthContextType {
  user: User | null
  session: Session | null
  membership: Membership | null
  business: Business | null
  role: UserRole | null
  isOwner: boolean
  isStaff: boolean
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
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMembership = async (userId: string): Promise<UserRole | null> => {
    try {
      // 1. Fetch user membership
      const { data: memberData, error: memberErr } = await supabase
        .from('memberships')
        .select('*, business:businesses(*)')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

      if (!memberErr && memberData) {
        const mem = memberData as Membership
        setMembership(mem)
        if (memberData.business) {
          setBusiness(memberData.business as Business)
        }
        return mem.role
      }

      // If no membership found, check if a default business exists and fallback
      const { data: defaultBiz } = await supabase
        .from('businesses')
        .select('*')
        .eq('slug', 'rangoli')
        .maybeSingle()

      if (defaultBiz) {
        setBusiness(defaultBiz as Business)
      }
      return null
    } catch (err) {
      console.warn('Could not load membership:', err)
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
        setMembership(null)
        setBusiness(null)
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

    let resolvedRole: UserRole | null = null
    if (!error && data.user) {
      resolvedRole = await loadMembership(data.user.id)
    }

    return { error: error ? new Error(error.message) : null, role: resolvedRole }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setMembership(null)
    setBusiness(null)
  }

  const refreshMembership = async () => {
    if (user) {
      await loadMembership(user.id)
    }
  }

  const role: UserRole | null = membership?.role || null
  const isOwner = role === 'owner'
  const isStaff = role === 'staff' || role === 'owner'

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        membership,
        business,
        role,
        isOwner,
        isStaff,
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
