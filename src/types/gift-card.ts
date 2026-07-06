/**
 * @file gift-card.ts
 * @description TypeScript types for gift cards and related entities.
 */

/** Accepted card types */
export type CardType = 'gift_card' | 'loyalty' | 'voucher' | 'prepaid';

/** UI category tags */
export type CardCategory =
  | 'shopping'
  | 'dining'
  | 'entertainment'
  | 'services'
  | 'online'
  | 'grocery'
  | 'fuel'
  | 'general';

/** Supported barcode formats */
export type BarcodeFormat =
  | 'CODE128'
  | 'QR'
  | 'EAN13'
  | 'PDF417'
  | 'CODE39';

/** Represents a single gift / loyalty card */
export interface GiftCard {
  id: string;
  user_id: string;

  // Core info
  brand_name: string;
  card_type: CardType;
  code: string | null;
  barcode_data: string | null;
  barcode_format: BarcodeFormat | null;
  pin: string | null;
  card_number: string | null;

  // Financial
  initial_amount: number | null;
  current_balance: number | null;
  currency: string;
  points_balance: number | null;

  // Dates (ISO 8601)
  issue_date: string | null;
  valid_until: string | null;

  // Metadata
  category: CardCategory;
  color: string;
  networks: string[];   // Parsed from JSON
  notes: string | null;
  tags: string[];       // Parsed from JSON
  is_favorite: boolean;
  is_archived: boolean;

  // Images
  image_front_url: string | null;
  image_front_local: string | null;
  image_back_url: string | null;
  image_back_local: string | null;

  // Reminders
  reminder_days_before: number;
  reminder_enabled: boolean;

  // Sync
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_synced: boolean;
  remote_version: number;
}

/** Raw row returned by SQLite before JSON parsing */
export interface GiftCardRow extends Omit<GiftCard, 'networks' | 'tags' | 'is_favorite' | 'is_archived' | 'reminder_enabled' | 'is_synced'> {
  networks: string;       // JSON string
  tags: string;           // JSON string
  is_favorite: number;    // SQLite integer boolean
  is_archived: number;
  reminder_enabled: number;
  is_synced: number;
}

/** Data required to create a new gift card (id, user_id, timestamps auto-generated) */
export type CreateGiftCardInput = Omit<
  GiftCard,
  'id' | 'created_at' | 'updated_at' | 'is_synced' | 'remote_version' | 'deleted_at'
>;

/** Data allowed when updating an existing gift card */
export type UpdateGiftCardInput = Partial<Omit<GiftCard, 'id' | 'user_id' | 'created_at'>>;

/** Sort options for card lists */
export type CardSortOrder =
  | 'recent'          // created_at DESC
  | 'expiring_soon'   // valid_until ASC (nulls last)
  | 'highest_balance' // current_balance DESC
  | 'alphabetical';   // brand_name ASC

/** Filter options for the dashboard */
export interface CardFilters {
  category?: CardCategory;
  is_archived?: boolean;
  is_favorite?: boolean;
  search?: string;
}
