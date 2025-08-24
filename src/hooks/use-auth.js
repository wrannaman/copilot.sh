"use client";

import { create } from 'zustand'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState, createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from "@/components/toast-provider"

const AuthContext = createContext(null)

// Create a singleton Supabase client for auth operations
let supabaseClient = null
const getSupabaseClient = () => {
  if (!supabaseClient) {
    supabaseClient = createClient()
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

  signInWithGoogle: async () => {
    const supabase = getSupabaseClient()
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${appUrl}/auth/callback`,
        // Use PKCE flow for better security
        flowType: 'pkce'
      }
    })
    return { data, error }
  },

  signInWithMagicLink: async (email) => {
    const supabase = getSupabaseClient()
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${appUrl}/auth/callback`,
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
      // Simple direct query instead of RPC
      const { data, error } = await supabase
        .from('organization_memberships')
        .select(`
          organizations (
            id,
            name,
            slug,
            logo_url,
            created_at
          )
        `)
        .eq('user_id', user.id);


      if (!error && data) {
        const orgs = data.map(item => ({
          org_id: item.organizations.id,
          org_name: item.organizations.name,
          name: item.organizations.name,
          slug: item.organizations.slug,
          logo_url: item.organizations.logo_url,
          created_at: item.organizations.created_at
        }));

        set({ organizations: orgs })

        if (orgs.length > 0 && !get().currentOrganization) {
          set({ currentOrganization: orgs[0] })
        }
      }

      return { data, error }
    } catch (error) {
      console.error("❌ Organization fetch failed:", error);
      // Create a default organization instead of failing
      const defaultOrg = {
        org_id: `default-${user.id.slice(0, 8)}`,
        name: 'My Organization',
        slug: `default-${user.id.slice(0, 8)}`,
        created_at: new Date().toISOString()
      };

      set({ organizations: [defaultOrg], currentOrganization: defaultOrg });

      return { data: [defaultOrg], error: null }
    }
  },

  createOrganization: async (name, slug) => {
    const supabase = getSupabaseClient()
    const { user } = get()
    if (!user) return { error: 'No user found' }

    try {

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Organization creation timeout')), 10000)
      );

      const createPromise = supabase.rpc('create_organization_with_owner', {
        org_name: name,
        org_slug: slug,
        owner_id: user.id
      });

      const { data, error } = await Promise.race([createPromise, timeoutPromise]);


      if (!error) {
        // Refresh organizations after creation
        await get().fetchOrganizations()
      }

      return { data, error }
    } catch (error) {
      console.error("❌ Organization creation failed:", error);
      return { data: null, error }
    }
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

          // Fetch organizations immediately if we have a session
          store.fetchOrganizations().catch(error => {
            console.error("❌ [AUTH] Initial organization fetch failed:", error);
          });

          // Best-effort Slack notification when a session exists
          try {
            if (session?.user?.email) {
              fetch('/api/notify-signup', { method: 'POST' }).catch(() => { })
            }
          } catch { }
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
      async (event, session) => {

        // Set user and session immediately
        store.setSession(session)
        store.setUser(session?.user ?? null)
        store.setLoading(false) // Set loading false immediately

        if (session?.user) {
          // Just fetch organizations - keep it simple
          store.fetchOrganizations().catch(error => {
            console.error("❌ Organization fetch failed:", error);
          });
        } else {
          store.setOrganizations([])
          store.setCurrentOrganization(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, []) // Empty dependency array - only run once on mount

  const loginWithGoogle = async () => {
    const { data, error } = await store.signInWithGoogle()

    if (error) {
      toast.error("Google login failed", {
        description: error.message
      })
      return { success: false, error }
    }

    // Note: OAuth redirects automatically, so success handling happens in callback
    return { success: true, data }
  }

  const loginWithMagicLink = async (email) => {
    const { data, error } = await store.signInWithMagicLink(email)

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

  return {
    ...context,
    ...storeState, // This ensures components re-render when store changes
  }
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