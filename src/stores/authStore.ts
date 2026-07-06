/**
 * @file authStore.ts
 * @description Zustand store for authentication state.
 *
 * Tracks the currently signed-in user and any in-flight auth operations.
 * Designed to be hydrated from Supabase Auth on app start, and updated
 * whenever auth state changes (sign-in, sign-out, token refresh).
 *
 * @example
 * ```tsx
 * const { user, isAuthenticated, setUser, clearAuth } = useAuthStore();
 * ```
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal user profile kept in memory for fast access. */
export interface AuthUser {
  /** Supabase Auth UID — also the primary key in the local `users` table. */
  id: string;
  email: string;
  displayName: string | null;
  preferredCurrency: string;
  language: 'he' | 'en';
  /** Whether biometric lock is currently active for this session. */
  isBiometricUnlocked: boolean;
}

/** Auth session state managed by the store. */
interface AuthState {
  /** The currently authenticated user, or null if not signed in. */
  user: AuthUser | null;
  /** True when an auth operation (sign-in, sign-out, restore) is in progress. */
  isLoading: boolean;
  /** Any auth error message to surface to the user. */
  error: string | null;
}

/** Actions that can be dispatched on the auth store. */
interface AuthActions {
  /** Hydrate the store with a signed-in user (called after successful auth). */
  setUser: (user: AuthUser) => void;
  /** Update individual profile fields (e.g. after settings save). */
  updateUser: (updates: Partial<AuthUser>) => void;
  /** Clear all auth state (called on sign-out or token expiry). */
  clearAuth: () => void;
  /** Set loading state for async auth operations. */
  setLoading: (loading: boolean) => void;
  /** Set a human-readable error message. Pass null to clear. */
  setError: (error: string | null) => void;
  /** Unlock the app after successful biometric authentication. */
  setBiometricUnlocked: (unlocked: boolean) => void;
}

// ---------------------------------------------------------------------------
// Derived selectors (stable references, re-exported for convenience)
// ---------------------------------------------------------------------------

/** True when a user is signed in. */
export const selectIsAuthenticated = (state: AuthState): boolean =>
  state.user !== null;

/** Returns the user's preferred language, defaulting to 'he'. */
export const selectLanguage = (state: AuthState): 'he' | 'en' =>
  state.user?.language ?? 'he';

/** Returns the user's preferred currency, defaulting to 'ILS'. */
export const selectCurrency = (state: AuthState): string =>
  state.user?.preferredCurrency ?? 'ILS';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Zustand auth store.
 *
 * Keep this store thin — it's purely in-memory state.
 * Persistence (Supabase session) is handled by the Supabase client.
 * Local user profile is persisted in SQLite via `database.ts`.
 */
export const useAuthStore = create<AuthState & AuthActions>()((set) => ({
  // ---- Initial state ----
  user: null,
  isLoading: false,
  error: null,

  // ---- Actions ----

  setUser: (user) =>
    set({
      user,
      isLoading: false,
      error: null,
    }),

  updateUser: (updates) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),

  clearAuth: () =>
    set({
      user: null,
      isLoading: false,
      error: null,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setBiometricUnlocked: (unlocked) =>
    set((state) => ({
      user: state.user
        ? { ...state.user, isBiometricUnlocked: unlocked }
        : null,
    })),
}));

/** Convenience: read the current user without subscribing to full store. */
export const getAuthUser = (): AuthUser | null =>
  useAuthStore.getState().user;
