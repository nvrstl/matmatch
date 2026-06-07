import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'

interface SignUpInput {
  email: string
  password: string
  role: Role
  fullName: string
}

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signUp: (input: SignUpInput) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile((data as Profile) ?? null)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next)
      if (next?.user) await loadProfile(next.user.id)
      else setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = useCallback(
    async ({ email, password, role, fullName }: SignUpInput) => {
      // role + full_name travel as user metadata; the `handle_new_user` DB trigger
      // creates the profiles / teacher_profiles / school_profiles rows server-side.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role, full_name: fullName } },
      })
      if (error) return { error: error.message }

      const userId = data.user?.id
      if (!userId) return { error: 'Account aangemaakt, maar geen gebruiker ontvangen.' }

      // No session yet means email confirmation is still ON in Supabase.
      if (!data.session) {
        return {
          error:
            'Account aangemaakt. Bevestig je e-mail om in te loggen — of schakel ' +
            'e-mailbevestiging uit in Supabase (Authentication → Email) voor de prototype.',
        }
      }

      await loadProfile(userId)
      return { error: null }
    },
    [loadProfile],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, signUp, signIn, signOut, refreshProfile }),
    [session, profile, loading, signUp, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth moet binnen <AuthProvider> gebruikt worden')
  return ctx
}
