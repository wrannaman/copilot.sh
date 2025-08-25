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

setTimeout(async () => {
  // Simple direct query with hard timeout to avoid hanging
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const queryPromise = await supabase
    .from('org_members')
    .select(`
   org (
     id,
     name,
     slug,
     logo_url,
     created_at
   )
 `)
    .eq('user_id', user.id)
  console.warn("🚀 ~ queryPromise:", queryPromise)
})

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
      // Ensure session token is present before querying
      console.log('after getSession')

      // Simple direct query with hard timeout to avoid hanging
      const queryPromise = supabase
        .from('org_members')
        .select(`
          org (
            id,
            name,
            logo_url,
            created_at
          )
        `)
        .eq('user_id', user.id)
      console.log("🚀 ~ queryPromise:", queryPromise)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('org_members fetch timeout')), 7000)
      )

      const { data, error } = await Promise.race([queryPromise, timeoutPromise])

      console.log("🚀 fetchOrganizations result ~ error:", error)
      console.log("🚀 fetchOrganizations result ~ data:", data)


      if (!error && data && data.length > 0) {
        const orgs = data.map(item => ({
          org_id: item.org.id,
          org_name: item.org.name,
          name: item.org.name,
          logo_url: item.org.logo_url,
          created_at: item.org.created_at
        }));

        set({ organizations: orgs })

        if (orgs.length > 0 && !get().currentOrganization) {
          set({ currentOrganization: orgs[0] })
        }

        return { data: orgs, error: null }
      }

      // No organizations found - create via server API (avoids client RLS quirks)
      console.log("📝 No orgs; calling server ensure endpoint...");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const resp = await fetch('/api/organizations/ensure', { method: 'POST', signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) {
          const t = await resp.json().catch(() => ({}));
          throw new Error(t?.details || t?.message || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const org = json?.organization;
        if (org?.id) {
          const orgEntry = {
            org_id: org.id,
            org_name: org.name,
            name: org.name,
            logo_url: org.logo_url,
            created_at: org.created_at,
          };
          set({ organizations: [orgEntry], currentOrganization: orgEntry });
          return { data: [orgEntry], error: null };
        }
        throw new Error('ensure endpoint returned no organization');
      } catch (e) {
        console.error('❌ ensure endpoint failed:', e?.message);
        return { data: null, error: e };
      }

    } catch (error) {
      console.error("❌ Organization fetch failed:", error);
      // If database error, try to create organization anyway
      const slug = `org-${user.id.slice(0, 8)}-${Date.now().toString(36).slice(-4)}`;
      const createResult = await get().createOrganization('My Organization', slug);

      console.log("🆘 Emergency create result:", createResult);

      if (createResult.error) {
        console.error("❌ Failed to create default organization:", createResult.error);
        return { data: null, error: createResult.error };
      }

      // Return the created organization directly
      return { data: get().organizations, error: null };
    }
  },

  ensureOrganization: async () => {
    console.log("🔒 ensureOrganization called");
    const { currentOrganization } = get()
    if (currentOrganization) {
      console.log("✅ Current organization exists:", currentOrganization);
      return currentOrganization;
    }

    console.log("🔍 No current organization, fetching...");
    const result = await get().fetchOrganizations()
    console.log("📊 fetchOrganizations result:", result);

    if (result.data && result.data.length > 0) {
      console.log("✅ Organization ensured:", result.data[0]);
      return result.data[0]
    }

    console.error("❌ Failed to ensure organization exists");
    throw new Error('Failed to ensure organization exists')
  },

  createOrganization: async (name, slug) => {
    console.log("🏗️ createOrganization called", { name, slug });
    const supabase = getSupabaseClient()
    const { user } = get()
    if (!user) {
      console.error("❌ No user found for org creation");
      return { error: 'No user found' }
    }

    console.log("👤 Creating org for user:", user.id);

    try {
      console.log("📞 Calling create_organization_with_owner RPC...");

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Organization creation timeout')), 10000)
      );

      const createPromise = supabase.rpc('create_organization_with_owner', {
        org_name: name,
        owner_id: user.id
      });

      const { data, error } = await Promise.race([createPromise, timeoutPromise]);

      console.log("📊 RPC result:", { data, error });

      if (error) {
        console.error("❌ RPC error:", error);

        // Fallback: try direct SQL insert if RPC fails
        console.log("🔧 Trying direct SQL fallback...");
        try {
          // Create organization directly
          const { data: orgData, error: orgError } = await supabase
            .from('org')
            .insert({ name, slug, display_name: name })
            .select('id')
            .single();

          if (orgError) {
            console.error("❌ Direct org creation failed:", orgError);
            return { data: null, error: orgError };
          }

          console.log("✅ Organization created via direct SQL:", orgData);

          // Create membership
          const { error: memberError } = await supabase
            .from('org_members')
            .insert({
              user_id: user.id,
              organization_id: orgData.id,
              role: 'owner'
            });

          if (memberError) {
            console.error("❌ Membership creation failed:", memberError);
            return { data: null, error: memberError };
          }

          console.log("✅ Membership created via direct SQL");

          // Set in state
          const newOrg = {
            org_id: orgData.id,
            org_name: name,
            name: name,
            slug: slug,
            created_at: new Date().toISOString()
          };

          set({
            organizations: [newOrg],
            currentOrganization: newOrg
          });

          return { data: orgData.id, error: null };

        } catch (fallbackError) {
          console.error("❌ Fallback creation failed:", fallbackError);
          return { data: null, error: fallbackError };
        }
      }

      console.log("✅ Organization created successfully:", data);

      // Don't call fetchOrganizations to avoid recursion
      // Instead, manually add the org to state
      const newOrg = {
        org_id: data,
        org_name: name,
        name: name,
        slug: slug,
        created_at: new Date().toISOString()
      };

      set({
        organizations: [newOrg],
        currentOrganization: newOrg
      });

      return { data, error: null }
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

          // Fetch organizations immediately if we have a session - this will create one if none exist
          try {
            await store.ensureOrganization();
            console.log("✅ Organization ensured during auth initialization");
          } catch (error) {
            console.error("❌ [AUTH] Failed to ensure organization during init:", error);
          }

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
          // Ensure organization exists - this will create one if needed
          try {
            await store.ensureOrganization();
            console.log("✅ Organization ensured during auth state change");
          } catch (error) {
            console.error("❌ Failed to ensure organization during auth:", error);
          }
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