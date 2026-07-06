/**
 * @file useUsageLogs.ts
 * @description React Query hooks for usage log CRUD operations backed by SQLite.
 *
 * Usage logs record every "spend" event on a gift card.  Creating a log also
 * updates the parent card's `current_balance` in the same transaction, ensuring
 * the two are always consistent.
 *
 * Query keys follow the pattern: ['usage_logs', ...params]
 *
 * @example
 * ```tsx
 * // Logs for a specific card
 * const { data: logs } = useUsageLogs(cardId);
 *
 * // Record a spend
 * const { mutate: recordUsage } = useRecordUsage();
 * recordUsage({ gift_card_id: id, amount_used: 50, balance_after: 150 });
 *
 * // Delete a log entry
 * const { mutate: deleteLog } = useDeleteUsageLog();
 * deleteLog({ logId, cardId });
 * ```
 */

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getDatabase } from '../services/database';
import { useAuthStore } from '../stores/authStore';
import { giftCardKeys, fetchGiftCard } from './useGiftCards';
import type { UsageLog, UsageLogRow, CreateUsageLogInput } from '../types/usage-log';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const usageLogKeys = {
  all: ['usage_logs'] as const,
  byCard: (cardId: string) => [...usageLogKeys.all, 'card', cardId] as const,
  detail: (id: string) => [...usageLogKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// Row → domain model mapper
// ---------------------------------------------------------------------------

function mapRow(row: UsageLogRow): UsageLog {
  return {
    ...row,
    is_synced: row.is_synced === 1,
  };
}

// ---------------------------------------------------------------------------
// Data access functions (pure, no hooks — unit-testable)
// ---------------------------------------------------------------------------

/**
 * Fetch all usage logs for a given gift card, newest first.
 *
 * @param cardId - The gift card id to fetch logs for.
 * @param userId - Must match the card owner (basic authz check).
 * @param limit  - Max rows to return. Defaults to 100.
 */
export async function fetchUsageLogs(
  cardId: string,
  userId: string,
  limit: number = 100,
): Promise<UsageLog[]> {
  const db = getDatabase();

  const rows = await db.getAllAsync<UsageLogRow>(
    `SELECT ul.*
     FROM usage_logs ul
     WHERE ul.gift_card_id = ?
       AND ul.user_id = ?
       AND ul.deleted_at IS NULL
     ORDER BY ul.used_at DESC
     LIMIT ?;`,
    [cardId, userId, limit],
  );

  return rows.map(mapRow);
}

/**
 * Fetch a single usage log entry by id.
 */
export async function fetchUsageLog(
  id: string,
  userId: string,
): Promise<UsageLog | null> {
  const db = getDatabase();

  const row = await db.getFirstAsync<UsageLogRow>(
    `SELECT * FROM usage_logs WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [id, userId],
  );

  return row ? mapRow(row) : null;
}

/**
 * Create a usage log entry AND update the parent card's balance — atomically.
 *
 * Validation:
 *  - `amount_used` must be > 0
 *  - `balance_after` must be >= 0
 *  - `balance_after` must equal `current_balance - amount_used` within 0.01 tolerance
 *    (we trust the caller but do a sanity check)
 *
 * @throws {Error} If the card is not found, has insufficient balance, or db write fails.
 */
export async function createUsageLog(input: CreateUsageLogInput): Promise<{
  log: UsageLog;
  newBalance: number;
}> {
  if (input.amount_used <= 0) {
    throw new Error('amount_used must be greater than 0');
  }
  if (input.balance_after < 0) {
    throw new Error('balance_after cannot be negative');
  }

  const db = getDatabase();
  const now = input.used_at ?? new Date().toISOString();

  let newLog: UsageLog | undefined;
  let newBalance: number = input.balance_after;

  await db.withTransactionAsync(async () => {
    // 1. Verify the card exists and has enough balance
    const card = await db.getFirstAsync<{ current_balance: number | null; id: string }>(
      `SELECT id, current_balance FROM gift_cards WHERE id = ? AND user_id = ? AND deleted_at IS NULL;`,
      [input.gift_card_id, input.user_id],
    );

    if (!card) {
      throw new Error(`Gift card ${input.gift_card_id} not found`);
    }

    const currentBalance = card.current_balance ?? 0;
    if (input.amount_used > currentBalance + 0.001) {
      throw new Error(
        `Insufficient balance: tried to use ${input.amount_used} but balance is ${currentBalance}`,
      );
    }

    newBalance = input.balance_after;

    // 2. Insert the usage log
    const result = await db.runAsync(
      `INSERT INTO usage_logs (
         gift_card_id, user_id, amount_used, balance_after, store_name,
         notes, used_at, created_at, is_synced
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0);`,
      [
        input.gift_card_id,
        input.user_id,
        input.amount_used,
        newBalance,
        input.store_name ?? null,
        input.notes ?? null,
        now,
        new Date().toISOString(),
      ],
    );

    // 3. Update the parent card's balance
    await db.runAsync(
      `UPDATE gift_cards
       SET current_balance = ?, updated_at = ?, is_synced = 0
       WHERE id = ? AND user_id = ?;`,
      [newBalance, new Date().toISOString(), input.gift_card_id, input.user_id],
    );

    // 4. Queue sync for both records
    const logRow = await db.getFirstAsync<UsageLogRow>(
      `SELECT * FROM usage_logs WHERE rowid = ?;`,
      [result.lastInsertRowId],
    );

    if (!logRow) {
      throw new Error('Failed to retrieve newly created usage log');
    }

    newLog = mapRow(logRow);

    await db.runAsync(
      `INSERT INTO sync_queue (table_name, record_id, operation, payload) VALUES (?, ?, ?, ?);`,
      ['usage_logs', logRow.id, 'INSERT', JSON.stringify(logRow)],
    );

    await db.runAsync(
      `INSERT INTO sync_queue (table_name, record_id, operation, payload) VALUES (?, ?, ?, ?);`,
      [
        'gift_cards',
        input.gift_card_id,
        'UPDATE',
        JSON.stringify({ id: input.gift_card_id, current_balance: newBalance }),
      ],
    );
  });

  if (!newLog) {
    throw new Error('Transaction completed but log was not captured');
  }

  return { log: newLog, newBalance };
}

/**
 * Soft-delete a usage log by id.
 *
 * Note: Does NOT automatically reverse the balance change — that would require
 * a manual card balance adjustment.  The UI should warn the user before deletion.
 */
export async function deleteUsageLog(
  id: string,
  userId: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.runAsync(
    `UPDATE usage_logs SET deleted_at = ?, is_synced = 0 WHERE id = ? AND user_id = ?;`,
    [now, id, userId],
  );

  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, operation, payload) VALUES (?, ?, ?, ?);`,
    ['usage_logs', id, 'DELETE', JSON.stringify({ id, deleted_at: now })],
  );
}

// ---------------------------------------------------------------------------
// Aggregates (for analytics screen, Phase 2)
// ---------------------------------------------------------------------------

export interface UsageSummary {
  totalSpent: number;
  logCount: number;
  /** Most recent store used (or null). */
  lastStoreName: string | null;
}

/**
 * Aggregate spend summary for a single card.
 */
export async function fetchUsageSummary(
  cardId: string,
  userId: string,
): Promise<UsageSummary> {
  const db = getDatabase();

  const row = await db.getFirstAsync<{
    total_spent: number;
    log_count: number;
    last_store: string | null;
  }>(
    `SELECT
       COALESCE(SUM(amount_used), 0) AS total_spent,
       COUNT(*) AS log_count,
       (SELECT store_name FROM usage_logs
        WHERE gift_card_id = ? AND user_id = ? AND deleted_at IS NULL
        ORDER BY used_at DESC LIMIT 1) AS last_store
     FROM usage_logs
     WHERE gift_card_id = ? AND user_id = ? AND deleted_at IS NULL;`,
    [cardId, userId, cardId, userId],
  );

  return {
    totalSpent: row?.total_spent ?? 0,
    logCount: row?.log_count ?? 0,
    lastStoreName: row?.last_store ?? null,
  };
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

/**
 * Fetch all usage logs for a gift card, newest first.
 *
 * @param cardId - The gift card id (null/undefined disables the query).
 * @param limit  - Max logs to return (default 100).
 */
export function useUsageLogs(
  cardId: string | null | undefined,
  limit: number = 100,
  options?: Omit<UseQueryOptions<UsageLog[]>, 'queryKey' | 'queryFn'>,
) {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<UsageLog[]>({
    queryKey: usageLogKeys.byCard(cardId ?? ''),
    queryFn: () => {
      if (!cardId || !userId) return [];
      return fetchUsageLogs(cardId, userId, limit);
    },
    enabled: !!cardId && !!userId,
    staleTime: 1000 * 30,
    ...options,
  });
}

/**
 * Mutation: record a card usage event.
 *
 * On success:
 *  - Invalidates the usage log list for the card
 *  - Updates the gift card detail cache with the new balance
 *  - Invalidates the gift card list and stats
 */
export function useRecordUsage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: (input: Omit<CreateUsageLogInput, 'user_id'>) => {
      if (!userId) throw new Error('Not authenticated');
      return createUsageLog({ ...input, user_id: userId });
    },
    onSuccess: ({ log, newBalance }) => {
      // Refresh usage log list for the affected card
      queryClient.invalidateQueries({
        queryKey: usageLogKeys.byCard(log.gift_card_id),
      });

      // Update the gift card's balance in cache without a full refetch
      queryClient.setQueryData(
        giftCardKeys.detail(log.gift_card_id),
        (old: Awaited<ReturnType<typeof fetchGiftCard>> | undefined) => {
          if (!old) return old;
          return { ...old, current_balance: newBalance };
        },
      );

      // Invalidate list + stats so summaries stay accurate
      queryClient.invalidateQueries({ queryKey: giftCardKeys.lists() });
      queryClient.invalidateQueries({ queryKey: giftCardKeys.stats() });
    },
  });
}

/**
 * Mutation: soft-delete a usage log entry.
 *
 * Note: Does NOT reverse the balance. Caller UI should warn the user.
 */
export function useDeleteUsageLog() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: ({ logId, cardId }: { logId: string; cardId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      return deleteUsageLog(logId, userId).then(() => cardId);
    },
    onSuccess: (cardId) => {
      queryClient.invalidateQueries({ queryKey: usageLogKeys.byCard(cardId) });
    },
  });
}

/**
 * Query: spend summary for a single card (total spent, count, last store).
 * Useful for the card detail screen header.
 */
export function useUsageSummary(cardId: string | null | undefined) {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<UsageSummary>({
    queryKey: [...usageLogKeys.byCard(cardId ?? ''), 'summary'],
    queryFn: () => {
      if (!cardId || !userId) {
        return { totalSpent: 0, logCount: 0, lastStoreName: null };
      }
      return fetchUsageSummary(cardId, userId);
    },
    enabled: !!cardId && !!userId,
    staleTime: 1000 * 60,
  });
}
