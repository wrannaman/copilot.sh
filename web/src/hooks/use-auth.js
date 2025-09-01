"use client";

import { create } from 'zustand'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState, createContext, useContext, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from "@/components/toast-provider"

const AuthContext = createContext(null)



// Create a singleton Supabase client for auth operations
let supabaseClient = null
let organizationsFetchPromise = null
const getSupabaseClient = () => {
  if (!supabaseClient) {
    supabaseClient = createClient()
    // Ensure client is properly initialized before use
    if (!supabaseClient.supabaseUrl || !supabaseClient.supabaseKey) {
      throw new Error('Supabase client initialization failed - missing URL or key')
    }
  }
  return supabaseClient
}

export const useAuthStore = create((set, get) => ({
  user: null,
  session: null,
  loading: true,
  organizations: [],
  currentOrganization: null,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
  setOrganizations: (organizations) => set({ organizations }),
  setCurrentOrganization: (org) => set({ currentOrganization: org }),
  refreshAuth: async () => {
    try {
      const supabase = getSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      set({ user: user || null })
      return user
    } catch (e) {
      console.error('❌ refreshAuth failed:', e)
      return null
    }
  },

  signInWithGoogle: async (nextPath) => {
    const supabase = getSupabaseClient()
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${appUrl}/auth/callback${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`,
        // Use PKCE flow for better security
        flowType: 'pkce'
      }
    })
    return { data, error }
  },

  signInWithMagicLink: async (email, nextPath) => {
    const supabase = getSupabaseClient()
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${appUrl}/auth/callback${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`,
        // Use PKCE flow for better security
        flowType: 'pkce'
      }
    })
    return { data, error }
  },

  signOut: async () => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()
    if (!error) {
      set({ user: null, session: null, organizations: [], currentOrganization: null })
    }
    return { error }
  },

  fetchOrganizations: async () => {
    const supabase = getSupabaseClient()
    const { user } = get()
    if (!user) return
    try {
      if (organizationsFetchPromise) return organizationsFetchPromise

      organizationsFetchPromise = (async () => {
        // Fast-path: if callback set org_id cookie, populate immediately
        try {
          if (typeof document !== 'undefined' && !get().currentOrganization) {
            const match = document.cookie.match(/(?:^|; )org_id=([^;]+)/)
            if (match) {
              const orgId = decodeURIComponent(match[1])
              if (orgId) {
                const minimal = { org_id: orgId, org_name: null, name: null, logo_url: null, created_at: null }
                set({ organizations: [minimal], currentOrganization: minimal })
              }
            }
          }
        } catch { }

        const { data, error } = await supabase.rpc('my_organizations')

        if (error) {
          console.error('❌ Organization fetch failed (RPC):', error)
          return { data: null, error }
        }

        const orgs = (data || []).map(row => ({
          org_id: row.org_id,
          org_name: row.org_name,
          name: row.org_name,
          logo_url: null,
          created_at: null,
        }))

        set({ organizations: orgs })
        if (orgs.length > 0) {
          set({ currentOrganization: orgs[0] })
        }
        return { data: orgs, error: null }
      })()

      const result = await organizationsFetchPromise
      organizationsFetchPromise = null
      return result

    } catch (error) {
      console.error('❌ Organization fetch failed (unexpected):', error)
      organizationsFetchPromise = null
      return { data: null, error }
    }
  },

  ensureOrganization: async () => {
    const { currentOrganization, user } = get()
    if (currentOrganization) {
      return currentOrganization;
    }
    if (!user) {
      // Not authenticated; nothing to ensure yet
      return null
    }

    const result = await get().fetchOrganizations()

    if (result && result.data && result.data.length > 0) {
      return result.data[0]
    }
    // No organizations yet; caller can handle null
    return null
  },

  createOrganization: async (_name) => {
    // Client-side org creation is disabled; org is ensured in server auth callback
    return { data: null, error: new Error('Org creation is server-managed') }
  }
}))

export function AuthProvider({ children }) {
  const store = useAuthStore()
  const [initialized, setInitialized] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const supabase = getSupabaseClient()

    const initializeAuth = async () => {
      try {
        // Actually check for existing session on hard refresh
        const { data: { session }, error } = await supabase.auth.getSession()


        if (!error && session) {
          store.setSession(session)
          store.setUser(session.user)
          setTimeout(async () => {
            try {
              await store.ensureOrganization();
            } catch (error) {
              console.error("❌ [AUTH] Failed to ensure organization during init:", error);
            }
          }, 0)
        }

        store.setLoading(false)
        setInitialized(true)
      } catch (error) {
        console.error('Auth initialization error:', error)
        store.setLoading(false)
        setInitialized(true)
      }
    }

    initializeAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Set user and session immediately (sync only)
        store.setSession(session)
        store.setUser(session?.user ?? null)
        store.setLoading(false)

        if (session?.user) {
          // Defer async operations to avoid deadlock
          setTimeout(async () => {
            try {
              await store.ensureOrganization();
            } catch (error) {
              console.error("❌ Failed to ensure organization during auth:", error);
            }
          }, 0)
        } else {
          store.setOrganizations([])
          store.setCurrentOrganization(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, []) // Empty dependency array - only run once on mount

  const loginWithGoogle = async (nextPath) => {
    const { data, error } = await store.signInWithGoogle(nextPath)

    if (error) {
      toast.error("Google login failed", {
        description: error.message
      })
      return { success: false, error }
    }

    // Note: OAuth redirects automatically, so success handling happens in callback
    return { success: true, data }
  }

  const loginWithMagicLink = async (email, nextPath) => {
    const { data, error } = await store.signInWithMagicLink(email, nextPath)

    if (error) {
      toast.error("Magic link failed", {
        description: error.message
      })
      return { success: false, error }
    }

    toast.success("Magic link sent!", {
      description: "Check your email for a login link."
    })
    return { success: true, data }
  }

  const logout = async () => {
    const { error } = await store.signOut()

    if (error) {
      toast.error("Logout error", {
        description: error.message
      })
      return { success: false, error }
    }

    toast.success("Logged out successfully", {
      description: "You have been signed out of your account."
    })
    return { success: true }
  }

  const value = {
    ...store,
    initialized,
    loginWithGoogle,
    loginWithMagicLink,
    logout,
    isAuthenticated: !!store.user,
    loading: store.loading || !initialized
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider")
  }

  // Use Zustand store directly to ensure proper reactivity
  const storeState = useAuthStore()

  // Memoize the return value to prevent infinite re-renders
  return useMemo(() => ({
    ...context,
    ...storeState,
  }), [
    context.initialized,
    context.loading,
    storeState.user,
    storeState.currentOrganization,
    storeState.organizations,
    storeState.session,
    storeState.loading
  ])
}

export const useRequireAuth = (redirectTo = '/auth/login') => {
  const { user, loading, initialized } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (initialized && !loading && !user) {
      router.push(redirectTo)
    }
  }, [user, loading, initialized, redirectTo, router])

  return { user, loading: loading || !initialized }
}

export const useRequireOrganization = () => {
  const { currentOrganization, organizations, loading } = useAuth()

  return {
    organization: currentOrganization,
    hasOrganization: !!currentOrganization,
    organizations,
    loading
  }
}

export function withAuth(Component) {
  return function AuthenticatedComponent(props) {
    const { isAuthenticated, loading } = useAuth()

    if (loading) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading...</p>
          </div>
        </div>
      )
    }

    if (!isAuthenticated) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
            <p className="text-muted-foreground">You need to be authenticated to view this page.</p>
            <a
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Sign In
            </a>
          </div>
        </div>
      )
    }

    return <Component {...props} />
  }
}