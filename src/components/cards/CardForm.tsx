/**
 * @file CardForm.tsx
 * @description Complex form component for adding/editing a gift card.
 *
 * ## Prerequisites — install before use:
 * ```bash
 * npx expo install zod @hookform/resolvers
 * npm install react-hook-form
 * ```
 *
 * ## Responsibilities
 * 1. **Validation**: Strict schema via Zod, enforced through React Hook Form.
 * 2. **Brand autocomplete**: Debounced search against the local `brand_catalog` SQLite table.
 * 3. **Encryption**: `pin`, `code`, and `card_number` are encrypted via `encryption.ts`
 *    BEFORE being passed to `useAddGiftCard` / `useUpdateGiftCard`.
 * 4. **Mode support**: Works in both `create` (add new card) and `edit` (prefill existing) modes.
 *
 * ## Props
 * - `mode?: 'create' | 'edit'`       — defaults to 'create'
 * - `initialValues?: Partial<GiftCardFormValues>` — for edit mode prefill
 * - `cardId?: string`                  — required in edit mode
 * - `onSuccess?: (card: GiftCard) => void` — called after successful save
 * - `onCancel?: () => void`            — for cancel button navigation
 *
 * @module cards/CardForm
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Platform,
  Alert,
  FlatList,
  KeyboardAvoidingView,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useAddGiftCard, useUpdateGiftCard } from '../../hooks/useGiftCards';
import { encryptCardFields } from '../../services/encryption';
import { getDatabase } from '../../services/database';
import type { GiftCard, CardType, CardCategory } from '../../types/gift-card';

// ---------------------------------------------------------------------------
// Zod schema — the single source of truth for form validation
// ---------------------------------------------------------------------------

/** Map of card type values to display labels. */
export const CARD_TYPE_OPTIONS: Record<CardType, string> = {
  gift_card: 'Gift Card',
  loyalty: 'Loyalty Card',
  voucher: 'Voucher',
  prepaid: 'Prepaid Card',
};

/** Map of category values to display labels. */
export const CARD_CATEGORY_OPTIONS: Record<CardCategory, string> = {
  shopping: 'Shopping',
  dining: 'Dining',
  entertainment: 'Entertainment',
  services: 'Services',
  online: 'Online',
  grocery: 'Grocery',
  fuel: 'Fuel',
  general: 'General',
};

/** Available card accent colors. */
export const CARD_COLORS = [
  { name: 'blue',   hex: '#2563EB' },
  { name: 'green',  hex: '#16A34A' },
  { name: 'red',    hex: '#DC2626' },
  { name: 'purple', hex: '#9333EA' },
  { name: 'orange', hex: '#EA580C' },
  { name: 'pink',   hex: '#DB2777' },
  { name: 'teal',   hex: '#0D9488' },
  { name: 'gray',   hex: '#4B5563' },
] as const;

/**
 * Zod validation schema for the card form.
 * Mirrors the `CreateGiftCardInput` type but with user-facing constraint messages.
 */
export const cardFormSchema = z
  .object({
    brand_name: z
      .string({ error: 'Brand name is required' })
      .min(1, 'Brand name is required')
      .max(100, 'Brand name must be 100 characters or fewer')
      .trim(),

    card_type: z.enum(['gift_card', 'loyalty', 'voucher', 'prepaid'] as const, {
      error: 'Card type is required',
    }),

    code: z
      .string()
      .max(64, 'Card code must be 64 characters or fewer')
      .trim()
      .optional()
      .or(z.literal('')),

    pin: z
      .string()
      .max(20, 'PIN must be 20 characters or fewer')
      .regex(/^[0-9a-zA-Z]*$/, 'PIN can only contain numbers and letters')
      .optional()
      .or(z.literal('')),

    card_number: z
      .string()
      .max(32, 'Card number must be 32 characters or fewer')
      .optional()
      .or(z.literal('')),

    initial_amount: z
      .string()
      .optional()
      .refine(
        (v) => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0),
        'Initial amount must be a non-negative number',
      ),

    current_balance: z
      .string()
      .optional()
      .refine(
        (v) => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0),
        'Balance must be a non-negative number',
      ),

    currency: z.string().min(1).max(10).default('ILS'),

    valid_until: z
      .string()
      .optional()
      .refine((v) => {
        if (!v) return true;
        const date = new Date(v);
        return !isNaN(date.getTime());
      }, 'Please enter a valid date (YYYY-MM-DD)')
      .or(z.literal('')),

    category: z.enum([
      'shopping',
      'dining',
      'entertainment',
      'services',
      'online',
      'grocery',
      'fuel',
      'general',
    ]).default('general'),

    color: z.string().default('blue'),

    notes: z
      .string()
      .max(500, 'Notes must be 500 characters or fewer')
      .optional()
      .or(z.literal('')),

    reminder_enabled: z.boolean().default(true),

    reminder_days_before: z
      .number()
      .int()
      .min(1, 'Must be at least 1 day')
      .max(365, 'Must be 365 days or fewer')
      .default(7),
  })
  .superRefine((data, ctx) => {
    // current_balance must not exceed initial_amount
    if (data.initial_amount && data.current_balance) {
      const initial = parseFloat(data.initial_amount);
      const current = parseFloat(data.current_balance);
      if (!isNaN(initial) && !isNaN(current) && current > initial) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Current balance cannot exceed initial amount',
          path: ['current_balance'],
        });
      }
    }

    // valid_until must be in the future or at least within the last year (user
    // might add an already-expired card intentionally)
    if (data.valid_until) {
      const date = new Date(data.valid_until);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (date < oneYearAgo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'This card expired over a year ago — are you sure?',
          path: ['valid_until'],
        });
      }
    }
  });

/** Parsed form values after Zod defaults/transforms have been applied. */
export type GiftCardFormValues = z.output<typeof cardFormSchema>;

/** Raw values managed by React Hook Form before Zod applies defaults. */
type GiftCardFormInputValues = z.input<typeof cardFormSchema>;

// ---------------------------------------------------------------------------
// Brand autocomplete types
// ---------------------------------------------------------------------------

interface BrandSuggestion {
  id: string;
  name: string;
  name_he: string | null;
  category: string | null;
  logo_url: string | null;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

export interface CardFormProps {
  /** 'create' shows "Add Card" button; 'edit' shows "Save Changes". Defaults to 'create'. */
  mode?: 'create' | 'edit';
  /** Prefill values for edit mode or scan-extracted data. */
  initialValues?: Partial<GiftCardFormValues>;
  /** Required when mode='edit' — the card being updated. */
  cardId?: string;
  /** Called with the saved GiftCard after a successful mutation. */
  onSuccess?: (card: GiftCard) => void;
  /** Called when the user taps Cancel. */
  onCancel?: () => void;
}

// ---------------------------------------------------------------------------
// CardForm component
// ---------------------------------------------------------------------------

/**
 * Full gift card entry / edit form.
 *
 * Renders all form fields with validation, brand autocomplete, and handles
 * encryption of sensitive fields before passing data to the mutation hook.
 */
export function CardForm({
  mode = 'create',
  initialValues,
  cardId,
  onSuccess,
  onCancel,
}: CardFormProps) {
  // ---- Hooks ----------------------------------------------------------------
  const { mutateAsync: addCard } = useAddGiftCard();
  const { mutateAsync: updateCard } = useUpdateGiftCard();

  // ---- Brand autocomplete state --------------------------------------------
  const [brandSuggestions, setBrandSuggestions] = useState<BrandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const brandDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Pin visibility -----------------------------------------------------
  const [pinVisible, setPinVisible] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- React Hook Form --------------------------------------------------------
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GiftCardFormInputValues, undefined, GiftCardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: {
      brand_name: '',
      card_type: 'gift_card',
      code: '',
      pin: '',
      card_number: '',
      initial_amount: '',
      current_balance: '',
      currency: 'ILS',
      valid_until: '',
      category: 'general',
      color: 'blue',
      notes: '',
      reminder_enabled: true,
      reminder_days_before: 7,
      ...initialValues,
    },
  });

  const selectedColor = watch('color');
  const reminderEnabled = watch('reminder_enabled');
  const cardType = watch('card_type');

  // ---- Brand autocomplete logic -----------------------------------------------

  /**
   * Searches the local brand_catalog SQLite table for brands matching the query.
   * Debounced at 300ms to avoid excessive DB calls.
   */
  const searchBrands = useCallback(async (query: string) => {
    if (query.length < 1) {
      setBrandSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const db = getDatabase();
      const results = await db.getAllAsync<BrandSuggestion>(
        `SELECT id, name, name_he, category, logo_url
         FROM brand_catalog
         WHERE name LIKE ? OR name_he LIKE ?
         ORDER BY name ASC
         LIMIT 10;`,
        [`%${query}%`, `%${query}%`],
      );
      setBrandSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch {
      // Brand catalog might be empty on first launch — fail silently
      setBrandSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const handleBrandChange = useCallback(
    (text: string, fieldOnChange: (value: string) => void) => {
      fieldOnChange(text);

      if (brandDebounceRef.current) clearTimeout(brandDebounceRef.current);
      brandDebounceRef.current = setTimeout(() => searchBrands(text), 300);
    },
    [searchBrands],
  );

  const handleSelectBrandSuggestion = useCallback(
    (suggestion: BrandSuggestion) => {
      setValue('brand_name', suggestion.name, { shouldValidate: true });
      if (suggestion.category) {
        // Auto-fill category from brand catalog if it matches our enum
        const validCategories = Object.keys(CARD_CATEGORY_OPTIONS) as CardCategory[];
        if (validCategories.includes(suggestion.category as CardCategory)) {
          setValue('category', suggestion.category as CardCategory);
        }
      }
      setShowSuggestions(false);
      setBrandSuggestions([]);
    },
    [setValue],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (brandDebounceRef.current) clearTimeout(brandDebounceRef.current);
    };
  }, []);

  // ---- Form submission -------------------------------------------------------

  /**
   * Handles form submission:
   * 1. Encrypts sensitive fields (code, pin, card_number).
   * 2. Converts string amounts to numbers.
   * 3. Calls the appropriate mutation (add or update).
   * 4. Invokes onSuccess callback.
   */
  const onSubmit = useCallback(
    async (values: GiftCardFormValues) => {
      try {
        setSubmitError(null);
        // Encrypt sensitive fields before persisting
        const { code, pin, card_number } = await encryptCardFields({
          code: values.code || null,
          pin: values.pin || null,
          card_number: values.card_number || null,
        });

        const payload = {
          brand_name: values.brand_name,
          card_type: values.card_type,
          code,
          pin,
          card_number,
          barcode_data: null,
          barcode_format: null,
          initial_amount: values.initial_amount ? parseFloat(values.initial_amount) : null,
          current_balance: values.current_balance
            ? parseFloat(values.current_balance)
            : values.initial_amount
            ? parseFloat(values.initial_amount)
            : null,
          currency: values.currency,
          points_balance: null,
          issue_date: new Date().toISOString(),
          valid_until: values.valid_until || null,
          category: values.category,
          color: values.color,
          networks: [],
          notes: values.notes || null,
          tags: [],
          is_favorite: false,
          is_archived: false,
          image_front_url: null,
          image_front_local: null,
          image_back_url: null,
          image_back_local: null,
          reminder_days_before: values.reminder_days_before,
          reminder_enabled: values.reminder_enabled,
          // user_id is injected by the hook
        };

        let savedCard: GiftCard;

        if (mode === 'edit' && cardId) {
          savedCard = await updateCard({ id: cardId, ...payload });
        } else {
          savedCard = await addCard(payload);
        }

        onSuccess?.(savedCard);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        console.error('[Gifty/CardForm] Failed to save card:', err);
        setSubmitError(message);
        Alert.alert('Failed to save card', message);
      }
    },
    [mode, cardId, addCard, updateCard, onSuccess],
  );

  const onInvalid = useCallback(() => {
    setSubmitError('Please fix the highlighted fields before saving.');
  }, []);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /** Renders a horizontally scrollable row of card-type tabs. */
  const renderCardTypePicker = () => (
    <View className="mb-4">
      <Text className="text-gray-700 text-sm mb-2 font-medium">Card Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {(Object.entries(CARD_TYPE_OPTIONS) as [CardType, string][]).map(([value, label]) => (
            <Controller
              key={value}
              control={control}
              name="card_type"
              render={({ field: { onChange, value: current } }) => (
                <TouchableOpacity
                  onPress={() => onChange(value)}
                  className={`px-4 py-2 rounded-full border ${
                    current === value
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white border-gray-300'
                  }`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: current === value }}
                >
                  <Text
                    className={`text-sm font-medium ${
                      current === value ? 'text-white' : 'text-gray-700'
                    }`}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          ))}
        </View>
      </ScrollView>
      {errors.card_type && (
        <Text className="text-red-500 text-xs mt-1">{errors.card_type.message}</Text>
      )}
    </View>
  );

  /** Renders a grid of color swatches. */
  const renderColorPicker = () => (
    <View className="mb-4">
      <Text className="text-gray-700 text-sm mb-2 font-medium">Card Color</Text>
      <View className="flex-row flex-wrap gap-2">
        {CARD_COLORS.map(({ name, hex }) => (
          <TouchableOpacity
            key={name}
            onPress={() => setValue('color', name)}
            className={`w-8 h-8 rounded-full ${
              selectedColor === name ? 'ring-2 ring-offset-2 ring-gray-900' : ''
            }`}
            style={{ backgroundColor: hex }}
            accessibilityLabel={`Select ${name} color`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selectedColor === name }}
          />
        ))}
      </View>
    </View>
  );

  /** Renders a dropdown-style category selector. */
  const renderCategoryPicker = () => (
    <View className="mb-4">
      <Text className="text-gray-700 text-sm mb-2 font-medium">Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {(Object.entries(CARD_CATEGORY_OPTIONS) as [CardCategory, string][]).map(
            ([value, label]) => (
              <Controller
                key={value}
                control={control}
                name="category"
                render={({ field: { onChange, value: current } }) => (
                  <TouchableOpacity
                    onPress={() => onChange(value)}
                    className={`px-3 py-1.5 rounded-full border ${
                      current === value
                        ? 'bg-gray-900 border-gray-900'
                        : 'bg-white border-gray-300'
                    }`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: current === value }}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        current === value ? 'text-white' : 'text-gray-600'
                      }`}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            ),
          )}
        </View>
      </ScrollView>
    </View>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Section: Core Info ─────────────────────────────────────────── */}
        <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-2 font-semibold">
          Card Details
        </Text>

        {/* Brand Name + Autocomplete */}
        <View className="relative mb-0">
          <Controller
            control={control}
            name="brand_name"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Brand Name"
                value={value}
                onChangeText={(text) => handleBrandChange(text, onChange)}
                onBlur={() => {
                  onBlur();
                  // Delay so tapping a suggestion registers before hiding
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                placeholder="e.g. Zara, Castro, McDonald's"
                error={errors.brand_name?.message}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                accessibilityLabel="Brand name input"
              />
            )}
          />

          {/* Autocomplete Dropdown */}
          {showSuggestions && brandSuggestions.length > 0 && (
            <View className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-hidden">
              <FlatList
                data={brandSuggestions}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="always"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectBrandSuggestion(item)}
                    className="px-4 py-3 border-b border-gray-100 last:border-0"
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${item.name}`}
                  >
                    <Text className="text-gray-900 font-medium text-sm">{item.name}</Text>
                    {item.name_he && (
                      <Text className="text-gray-500 text-xs mt-0.5">{item.name_he}</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>

        {/* Card Type Tabs */}
        {renderCardTypePicker()}

        {/* ── Section: Card Code & PIN ────────────────────────────────────── */}
        <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-2 font-semibold">
          Card Number & Security
        </Text>

        <Controller
          control={control}
          name="code"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Card Code / Number"
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. 1234-5678-9012"
              error={errors.code?.message}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Card code input"
            />
          )}
        />

        <Controller
          control={control}
          name="pin"
          render={({ field: { onChange, onBlur, value } }) => (
            <View className="relative">
              <Input
                label="PIN / CVV (optional)"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="e.g. 1234"
                error={errors.pin?.message}
                secureTextEntry={!pinVisible}
                keyboardType="numeric"
                autoCorrect={false}
                accessibilityLabel="Card PIN input"
              />
              <TouchableOpacity
                className="absolute right-3 top-9"
                onPress={() => setPinVisible((v) => !v)}
                accessibilityLabel={pinVisible ? 'Hide PIN' : 'Show PIN'}
              >
                <Text className="text-blue-600 text-sm font-medium">
                  {pinVisible ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />

        {/* ── Section: Balance ────────────────────────────────────────────── */}
        {/* Only show monetary fields for non-loyalty cards */}
        {cardType !== 'loyalty' && (
          <>
            <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-2 font-semibold">
              Balance
            </Text>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Controller
                  control={control}
                  name="initial_amount"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Initial Amount"
                      value={value ?? ''}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      placeholder="0.00"
                      error={errors.initial_amount?.message}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Initial amount input"
                    />
                  )}
                />
              </View>
              <View className="flex-1">
                <Controller
                  control={control}
                  name="current_balance"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <Input
                      label="Current Balance"
                      value={value ?? ''}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      placeholder="0.00"
                      error={errors.current_balance?.message}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Current balance input"
                    />
                  )}
                />
              </View>
            </View>

            <Controller
              control={control}
              name="currency"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Currency"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="ILS"
                  error={errors.currency?.message}
                  autoCapitalize="characters"
                  maxLength={3}
                  accessibilityLabel="Currency input"
                />
              )}
            />
          </>
        )}

        {/* ── Section: Dates ──────────────────────────────────────────────── */}
        <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-2 font-semibold">
          Dates
        </Text>

        <Controller
          control={control}
          name="valid_until"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Expiry Date (YYYY-MM-DD)"
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. 2025-12-31 (leave blank if no expiry)"
              error={errors.valid_until?.message}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              accessibilityLabel="Expiry date input"
            />
          )}
        />

        {/* ── Section: Categorisation ─────────────────────────────────────── */}
        <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-2 font-semibold">
          Category & Appearance
        </Text>

        {renderCategoryPicker()}
        {renderColorPicker()}

        {/* ── Section: Notes ──────────────────────────────────────────────── */}
        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Notes (optional)"
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Any extra details about this card…"
              error={errors.notes?.message}
              multiline
              numberOfLines={3}
              style={{ height: 80, textAlignVertical: 'top' }}
              accessibilityLabel="Notes input"
            />
          )}
        />

        {/* ── Section: Reminders ──────────────────────────────────────────── */}
        <Text className="text-gray-400 text-xs uppercase tracking-wider mb-3 mt-4 font-semibold">
          Expiry Reminder
        </Text>

        <View className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3">
          <Text className="text-gray-700 font-medium">Enable reminder</Text>
          <Controller
            control={control}
            name="reminder_enabled"
            render={({ field: { onChange, value } }) => (
              <Switch
                value={value}
                onValueChange={onChange}
                trackColor={{ false: '#D1D5DB', true: '#2563EB' }}
                thumbColor={value ? '#FFFFFF' : '#F3F4F6'}
                accessibilityLabel="Toggle expiry reminder"
                accessibilityRole="switch"
              />
            )}
          />
        </View>

        {reminderEnabled && (
          <Controller
            control={control}
            name="reminder_days_before"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Days before expiry to remind"
                value={String(value)}
                onChangeText={(text) => {
                  const num = parseInt(text, 10);
                  if (!isNaN(num)) onChange(num);
                }}
                onBlur={onBlur}
                placeholder="7"
                error={errors.reminder_days_before?.message}
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel="Reminder days input"
              />
            )}
          />
        )}

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        {submitError && (
          <Text className="text-red-600 text-sm mb-3" accessibilityRole="alert">
            {submitError}
          </Text>
        )}

        <View className="flex-row gap-3 mt-4">
          {onCancel && (
            <Button
              label="Cancel"
              variant="outline"
              onPress={onCancel}
              className="flex-1"
              accessibilityLabel="Cancel"
            />
          )}
          <Button
            label={isSubmitting
              ? 'Saving…'
              : mode === 'edit' ? 'Save Changes' : 'Add Card'}
            variant="primary"
            onPress={handleSubmit(onSubmit, onInvalid)}
            isLoading={isSubmitting}
            className={onCancel ? 'flex-1' : 'w-full'}
            accessibilityLabel={mode === 'edit' ? 'Save changes' : 'Add card'}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
