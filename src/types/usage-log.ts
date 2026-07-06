/**
 * @file usage-log.ts
 * @description TypeScript types for card usage logs.
 */

/** A single spending record linked to a gift card */
export interface UsageLog {
  id: string;
  gift_card_id: string;
  user_id: string;

  amount_used: number;
  balance_after: number;
  store_name: string | null;
  notes: string | null;
  used_at: string;       // ISO 8601

  // Sync
  created_at: string;
  deleted_at: string | null;
  is_synced: boolean;
}

/** Raw SQLite row for usage_logs */
export interface UsageLogRow extends Omit<UsageLog, 'is_synced'> {
  is_synced: number;
}

/** Input for recording a new usage event */
export interface CreateUsageLogInput {
  gift_card_id: string;
  user_id: string;
  amount_used: number;
  balance_after: number;
  store_name?: string;
  notes?: string;
  used_at?: string; // Defaults to now if omitted
}
