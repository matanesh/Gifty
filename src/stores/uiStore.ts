/**
 * @file uiStore.ts
 * @description Zustand store for UI state: theme, language, filters, and transient overlays.
 *
 * Covers:
 *  - Theme (light / dark / system)
 *  - Active language (drives i18n)
 *  - Dashboard filter & sort preferences
 *  - Global loading overlay
 *  - Toast / snackbar notifications
 *
 * @example
 * ```tsx
 * const { theme, setTheme } = useUiStore();
 * const filters = useUiStore((s) => s.cardFilters);
 * ```
 */

import { create } from 'zustand';
import type { CardCategory, CardFilters, CardSortOrder } from '../types/gift-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppTheme = 'light' | 'dark' | 'system';
export type AppLanguage = 'he' | 'en';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  /** Auto-dismiss after this many milliseconds. Default: 3000. */
  durationMs?: number;
}

interface UiState {
  /** Current theme preference. */
  theme: AppTheme;
  /** Active language — controls RTL layout and locale strings. */
  language: AppLanguage;

  /** Active filters for the dashboard card list. */
  cardFilters: CardFilters;
  /** Active sort order for the dashboard card list. */
  cardSortOrder: CardSortOrder;

  /** Whether the global full-screen loading overlay is visible. */
  isGlobalLoading: boolean;
  /** Optional message shown inside the global loading overlay. */
  globalLoadingMessage: string | null;

  /** Queue of toast notifications to display. */
  toasts: ToastMessage[];

  /** Whether the "Add Card" bottom sheet / modal is open. */
  isAddCardSheetOpen: boolean;

  /** Id of the card whose "Use Card" sheet is currently open (null = closed). */
  activeUseCardId: string | null;
}

interface UiActions {
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;

  /** Merge partial filter updates — does NOT reset unspecified filters. */
  setCardFilters: (filters: Partial<CardFilters>) => void;
  /** Reset all card filters to defaults. */
  resetCardFilters: () => void;
  setCardSortOrder: (order: CardSortOrder) => void;

  setGlobalLoading: (loading: boolean, message?: string) => void;

  /** Add a toast to the queue. */
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** Remove a toast by id (called after dismiss animation). */
  dismissToast: (id: string) => void;

  openAddCardSheet: () => void;
  closeAddCardSheet: () => void;

  openUseCardSheet: (cardId: string) => void;
  closeUseCardSheet: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: CardFilters = {
  is_archived: false,
};

const DEFAULT_SORT: CardSortOrder = 'recent';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let _toastCounter = 0;

/**
 * Zustand UI store.
 *
 * Pure in-memory state — not persisted.  Language & theme preferences should
 * also be written to SQLite (user profile) and restored on startup via the
 * `useAuth` hook or an app-level initializer.
 */
export const useUiStore = create<UiState & UiActions>()((set) => ({
  // ---- Initial state ----
  theme: 'system',
  language: 'he',

  cardFilters: DEFAULT_FILTERS,
  cardSortOrder: DEFAULT_SORT,

  isGlobalLoading: false,
  globalLoadingMessage: null,

  toasts: [],

  isAddCardSheetOpen: false,
  activeUseCardId: null,

  // ---- Actions ----

  setTheme: (theme) => set({ theme }),

  setLanguage: (language) => set({ language }),

  setCardFilters: (filters) =>
    set((state) => ({
      cardFilters: { ...state.cardFilters, ...filters },
    })),

  resetCardFilters: () => set({ cardFilters: DEFAULT_FILTERS }),

  setCardSortOrder: (cardSortOrder) => set({ cardSortOrder }),

  setGlobalLoading: (loading, message) =>
    set({
      isGlobalLoading: loading,
      globalLoadingMessage: loading ? (message ?? null) : null,
    }),

  showToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: String(++_toastCounter) },
      ],
    })),

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  openAddCardSheet: () => set({ isAddCardSheetOpen: true }),
  closeAddCardSheet: () => set({ isAddCardSheetOpen: false }),

  openUseCardSheet: (cardId) => set({ activeUseCardId: cardId }),
  closeUseCardSheet: () => set({ activeUseCardId: null }),
}));

// ---------------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------------

/** True when the active language is RTL (Hebrew). */
export const selectIsRTL = (state: UiState): boolean =>
  state.language === 'he';

/** True when dark mode is explicitly selected (not 'system'). */
export const selectIsDarkMode = (state: UiState): boolean =>
  state.theme === 'dark';

/** Quick helper to get filter by category from outside React. */
export const getActiveCategory = (): CardCategory | undefined =>
  useUiStore.getState().cardFilters.category;
