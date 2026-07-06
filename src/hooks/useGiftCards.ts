/**
 * @file useGiftCards.ts
 * @description React Query hooks for gift card CRUD operations backed by SQLite.
 *
 * All writes go to local SQLite first (offline-first), then queue a sync entry.
 * React Query cache is kept in sync via query invalidation after mutations.
 *
 * Query keys follow the pattern: ['gift_cards', ...params]
 *
 * @example
 * ```tsx
 * // List all cards
 * const { data: cards, isLoading } = useGiftCards();
 *
 * // Get a single card
 * const { data: card } = useGiftCard(id);
 *
 * // Add a card
 * const { mutate: addCard } = useAddGiftCard();
 * addCard({ brand_name: 'Zara', ... });
 *
 * // Update balance after usage
 * const { mutate: updateCard } = useUpdateGiftCard();
 * updateCard({ id, current_balance: 50 });
 *
 * // Soft delete
 * const { mutate: deleteCard } = useDeleteGiftCard();
 * deleteCard(id);
 * ```
 */

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getDatabase } from '../services/database';
import { useAuthStore } from '../stores/authStore';
import type {
  GiftCard,
  GiftCardRow,
  CreateGiftCardInput,
  UpdateGiftCardInput,
  CardFilters,
  CardSortOrder,
} from '../types/gift-card';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const giftCardKeys = {
  all: ['gift_cards'] as const,
  lists: () => [...giftCardKeys.all, 'list'] as const,
  list: (filters: CardFilters, sort: CardSortOrder) =>
    [...giftCardKeys.lists(), { filters, sort }] as const,
  details: () => [...giftCardKeys.all, 'detail'] as const,
  detail: (id: string) => [...giftCardKeys.details(), id] as const,
  stats: () => [...giftCardKeys.all, 'stats'] as const,
};

// ---------------------------------------------------------------------------
// Row → domain model mapper
// ---------------------------------------------------------------------------

/**
 * Maps a raw SQLite row (with JSON strings and integer booleans) to the
 * typed `GiftCard` domain model.
 */
function mapRow(row: GiftCardRow): GiftCard {
  return {
    ...row,
    networks: safeParseJsonArray(row.networks),
    tags: safeParseJsonArray(row.tags),
    is_favorite: row.is_favorite === 1,
    is_archived: row.is_archived === 1,
    reminder_enabled: row.reminder_enabled === 1,
    is_synced: row.is_synced === 1,
  };
}

function safeParseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/**
 * Build the WHERE clause and its bound params from a `CardFilters` object.
 * Always scoped to the current user's `user_id`.
 */
function buildWhereClause(
  userId: string,
  filters: CardFilters,
): { clause: string; params: (string | number | null)[] } {
  const conditions: string[] = ['user_id = ?', 'deleted_at IS NULL'];
  const params: (string | number | null)[] = [userId];

  if (filters.is_archived !== undefined) {
    conditions.push('is_archived = ?');
    params.push(filters.is_archived ? 1 : 0);
  }

  if (filters.is_favorite !== undefined) {
    conditions.push('is_favorite = ?');
    params.push(filters.is_favorite ? 1 : 0);
  }

  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }

  if (filters.search) {
    // Simple LIKE search across brand_name, notes and serialised tags/networks
    conditions.push(
      "(brand_name LIKE ? OR notes LIKE ? OR tags LIKE ? OR networks LIKE ?)",
    );
    const term = `%${filters.search}%`;
    params.push(term, term, term, term);
  }

  return { clause: conditions.join(' AND '), params };
}

/** Map sort order enum to ORDER BY clause. */
function buildOrderClause(sort: CardSortOrder): string {
  switch (sort) {
    case 'recent':
      return 'created_at DESC';
    case 'expiring_soon':
      // NULL valid_until (no expiry) goes to the end
      return "CASE WHEN valid_until IS NULL THEN 1 ELSE 0 END, valid_until ASC";
    case 'highest_balance':
      return 'current_balance DESC NULLS LAST';
    case 'alphabetical':
      return 'brand_name ASC COLLATE NOCASE';
    default:
      return 'created_at DESC';
  }
}

// ---------------------------------------------------------------------------
// Data access functions (not hooks — testable without React)
// ---------------------------------------------------------------------------

/**
 * Fetch all cards for a user with optional filters and sort.
 */
export async function fetchGiftCards(
  userId: string,
  filters: CardFilters = { is_archived: false },
  sort: CardSortOrder = 'recent',
): Promise<GiftCard[]> {
  const db = getDatabase();
  const { clause, params } = buildWhereClause(userId, filters);
  const order = buildOrderClause(sort);

  const rows = await db.getAllAsync<GiftCardRow>(
    `SELECT * FROM gift_cards WHERE ${clause} ORDER BY ${order};`,
    params,
  );

  return rows.map(mapRow);
}

/**
 * Fetch a single card by id (must belong to the requesting user).
 */
export async function fetchGiftCard(
  id: string,
  userId: string,
): Promise<GiftCard | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<GiftCardRow>(
    `SELECT * FROM gift_cards WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [id, userId],
  );
  return row ? mapRow(row) : null;
}

/**
 * Create a new gift card record.
 * Generates a UUID via SQLite's `lower(hex(randomblob(16)))`.
 */
export async function createGiftCard(
  input: CreateGiftCardInput,
): Promise<GiftCard> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Serialize arrays back to JSON strings for storage
  const networks = JSON.stringify(input.networks ?? []);
  const tags = JSON.stringify(input.tags ?? []);

  const result = await db.runAsync(
    `INSERT INTO gift_cards (
      user_id, brand_name, card_type, code, barcode_data, barcode_format, pin,
      card_number, initial_amount, current_balance, currency, points_balance,
      issue_date, valid_until, category, color, networks, notes, tags,
      is_favorite, is_archived, image_front_url, image_front_local,
      image_back_url, image_back_local, reminder_days_before, reminder_enabled,
      created_at, updated_at, is_synced, remote_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, 0, 0
    ) RETURNING id;`,
    [
      input.user_id,
      input.brand_name,
      input.card_type ?? 'gift_card',
      input.code ?? null,
      input.barcode_data ?? null,
      input.barcode_format ?? null,
      input.pin ?? null,
      input.card_number ?? null,
      input.initial_amount ?? null,
      input.current_balance ?? null,
      input.currency ?? 'ILS',
      input.points_balance ?? null,
      input.issue_date ?? null,
      input.valid_until ?? null,
      input.category ?? 'general',
      input.color ?? 'blue',
      networks,
      input.notes ?? null,
      tags,
      input.is_favorite ? 1 : 0,
      input.is_archived ? 1 : 0,
      input.image_front_url ?? null,
      input.image_front_local ?? null,
      input.image_back_url ?? null,
      input.image_back_local ?? null,
      input.reminder_days_before ?? 7,
      input.reminder_enabled !== false ? 1 : 0,
      now,
      now,
    ],
  );

  // Retrieve the newly inserted row by rowId
  const row = await db.getFirstAsync<GiftCardRow>(
    `SELECT * FROM gift_cards WHERE rowid = ?;`,
    [result.lastInsertRowId],
  );

  if (!row) {
    throw new Error('Failed to retrieve newly created gift card');
  }

  // Queue sync operation
  await enqueueSyncOperation(db, 'gift_cards', row.id, 'INSERT', row);

  return mapRow(row);
}

/**
 * Update an existing gift card's fields.
 * Automatically bumps `updated_at` and resets `is_synced` to 0.
 */
export async function updateGiftCard(
  id: string,
  userId: string,
  updates: UpdateGiftCardInput,
): Promise<GiftCard> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = ['updated_at = ?', 'is_synced = 0'];
  const params: (string | number | null)[] = [now];

  const fieldMap: Record<string, (v: unknown) => string | number | null> = {
    brand_name:           (v) => v as string,
    card_type:            (v) => v as string,
    code:                 (v) => (v as string | null) ?? null,
    barcode_data:         (v) => (v as string | null) ?? null,
    barcode_format:       (v) => (v as string | null) ?? null,
    pin:                  (v) => (v as string | null) ?? null,
    card_number:          (v) => (v as string | null) ?? null,
    initial_amount:       (v) => (v as number | null) ?? null,
    current_balance:      (v) => (v as number | null) ?? null,
    currency:             (v) => v as string,
    points_balance:       (v) => (v as number | null) ?? null,
    issue_date:           (v) => (v as string | null) ?? null,
    valid_until:          (v) => (v as string | null) ?? null,
    category:             (v) => v as string,
    color:                (v) => v as string,
    networks:             (v) => JSON.stringify(Array.isArray(v) ? v : []),
    notes:                (v) => (v as string | null) ?? null,
    tags:                 (v) => JSON.stringify(Array.isArray(v) ? v : []),
    is_favorite:          (v) => (v ? 1 : 0),
    is_archived:          (v) => (v ? 1 : 0),
    image_front_url:      (v) => (v as string | null) ?? null,
    image_front_local:    (v) => (v as string | null) ?? null,
    image_back_url:       (v) => (v as string | null) ?? null,
    image_back_local:     (v) => (v as string | null) ?? null,
    reminder_days_before: (v) => v as number,
    reminder_enabled:     (v) => (v ? 1 : 0),
    deleted_at:           (v) => (v as string | null) ?? null,
  };

  for (const [key, transform] of Object.entries(fieldMap)) {
    if (key in updates) {
      sets.push(`${key} = ?`);
      params.push(transform((updates as Record<string, unknown>)[key]));
    }
  }

  params.push(id, userId);

  await db.runAsync(
    `UPDATE gift_cards SET ${sets.join(', ')} WHERE id = ? AND user_id = ?;`,
    params,
  );

  const updated = await fetchGiftCard(id, userId);
  if (!updated) {
    throw new Error(`Gift card ${id} not found after update`);
  }

  await enqueueSyncOperation(db, 'gift_cards', id, 'UPDATE', updated);

  return updated;
}

/**
 * Soft-delete a gift card by setting `deleted_at`.
 * The record stays in SQLite for sync purposes until confirmed deleted on remote.
 */
export async function deleteGiftCard(
  id: string,
  userId: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE gift_cards
     SET deleted_at = ?, updated_at = ?, is_synced = 0
     WHERE id = ? AND user_id = ?;`,
    [now, now, id, userId],
  );

  await enqueueSyncOperation(db, 'gift_cards', id, 'DELETE', { id, deleted_at: now });
}

// ---------------------------------------------------------------------------
// Sync queue helper
// ---------------------------------------------------------------------------

async function enqueueSyncOperation(
  db: Awaited<ReturnType<typeof getDatabase>>,
  tableName: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: unknown,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, operation, payload) VALUES (?, ?, ?, ?);`,
    [tableName, recordId, operation, JSON.stringify(payload)],
  );
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export interface GiftCardStats {
  totalActiveCards: number;
  totalBalance: number;
  expiringWithin30Days: number;
  currency: string;
}

export async function fetchGiftCardStats(
  userId: string,
  currency: string = 'ILS',
): Promise<GiftCardStats> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const row = await db.getFirstAsync<{
    total_active: number;
    total_balance: number;
    expiring_soon: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE is_archived = 0) AS total_active,
       COALESCE(SUM(current_balance) FILTER (WHERE is_archived = 0 AND currency = ?), 0) AS total_balance,
       COUNT(*) FILTER (WHERE is_archived = 0 AND valid_until IS NOT NULL AND valid_until BETWEEN ? AND ?) AS expiring_soon
     FROM gift_cards
     WHERE user_id = ? AND deleted_at IS NULL;`,
    [currency, now, in30Days, userId],
  );

  return {
    totalActiveCards: row?.total_active ?? 0,
    totalBalance: row?.total_balance ?? 0,
    expiringWithin30Days: row?.expiring_soon ?? 0,
    currency,
  };
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

/**
 * Fetch a list of gift cards for the current user.
 *
 * @param filters - Optional filters (category, archived, favorites, search).
 * @param sort - Sort order (default: 'recent').
 * @param options - Additional React Query options.
 */
export function useGiftCards(
  filters: CardFilters = { is_archived: false },
  sort: CardSortOrder = 'recent',
  options?: Omit<UseQueryOptions<GiftCard[]>, 'queryKey' | 'queryFn'>,
) {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<GiftCard[]>({
    queryKey: giftCardKeys.list(filters, sort),
    queryFn: () => {
      if (!userId) return [];
      return fetchGiftCards(userId, filters, sort);
    },
    enabled: !!userId,
    staleTime: 1000 * 30, // 30 seconds — data is local, refreshes are cheap
    ...options,
  });
}

/**
 * Fetch a single gift card by id.
 */
export function useGiftCard(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<GiftCard | null>, 'queryKey' | 'queryFn'>,
) {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<GiftCard | null>({
    queryKey: giftCardKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id || !userId) return null;
      return fetchGiftCard(id, userId);
    },
    enabled: !!id && !!userId,
    staleTime: 1000 * 30,
    ...options,
  });
}

/**
 * Fetch dashboard stats (total balance, card count, expiring soon).
 */
export function useGiftCardStats(currency?: string) {
  const user = useAuthStore((s) => s.user);

  return useQuery<GiftCardStats>({
    queryKey: [...giftCardKeys.stats(), currency ?? user?.preferredCurrency ?? 'ILS'],
    queryFn: () => {
      if (!user) {
        return { totalActiveCards: 0, totalBalance: 0, expiringWithin30Days: 0, currency: 'ILS' };
      }
      return fetchGiftCardStats(user.id, currency ?? user.preferredCurrency);
    },
    enabled: !!user,
    staleTime: 1000 * 60, // 1 minute for stats
  });
}

/**
 * Mutation: add a new gift card.
 * Invalidates the card list on success.
 */
export function useAddGiftCard() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: (input: Omit<CreateGiftCardInput, 'user_id'>) => {
      if (!userId) throw new Error('Not authenticated');
      return createGiftCard({ ...input, user_id: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: giftCardKeys.lists() });
      queryClient.invalidateQueries({ queryKey: giftCardKeys.stats() });
    },
  });
}

/**
 * Mutation: update an existing gift card.
 * Invalidates both the list and the specific card detail on success.
 */
export function useUpdateGiftCard() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string } & UpdateGiftCardInput) => {
      if (!userId) throw new Error('Not authenticated');
      return updateGiftCard(id, userId, updates);
    },
    onSuccess: (updatedCard) => {
      // Update detail cache immediately (no extra fetch needed)
      queryClient.setQueryData(
        giftCardKeys.detail(updatedCard.id),
        updatedCard,
      );
      queryClient.invalidateQueries({ queryKey: giftCardKeys.lists() });
      queryClient.invalidateQueries({ queryKey: giftCardKeys.stats() });
    },
  });
}

/**
 * Mutation: soft-delete a gift card.
 * Removes it from the list cache on success.
 */
export function useDeleteGiftCard() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: (id: string) => {
      if (!userId) throw new Error('Not authenticated');
      return deleteGiftCard(id, userId);
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: giftCardKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: giftCardKeys.lists() });
      queryClient.invalidateQueries({ queryKey: giftCardKeys.stats() });
    },
  });
}

/**
 * Mutation: toggle a card's favorite status.
 * Convenience wrapper around useUpdateGiftCard for a common action.
 */
export function useToggleFavorite() {
  const update = useUpdateGiftCard();

  return {
    ...update,
    mutate: (id: string, currentValue: boolean) =>
      update.mutate({ id, is_favorite: !currentValue }),
    mutateAsync: (id: string, currentValue: boolean) =>
      update.mutateAsync({ id, is_favorite: !currentValue }),
  };
}

/**
 * Mutation: archive or unarchive a card.
 */
export function useArchiveGiftCard() {
  const update = useUpdateGiftCard();

  return {
    ...update,
    mutate: (id: string, archive: boolean) =>
      update.mutate({ id, is_archived: archive }),
    mutateAsync: (id: string, archive: boolean) =>
      update.mutateAsync({ id, is_archived: archive }),
  };
}
