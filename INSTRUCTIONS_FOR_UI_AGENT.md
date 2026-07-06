# Gifty — UI Agent Build Instructions

**READ EVERY LINE BEFORE WRITING ANY CODE.**

You are a UI-focused agent. Your ONLY job is to build three screen files:
1. `app/(tabs)/index.tsx` — Dashboard
2. `app/card/add.tsx` — Add Card screen
3. `app/card/[id].tsx` — Card Detail screen

The complex logic is already built. You are wiring up existing components and hooks.
DO NOT modify any existing files. Only CREATE the three files listed above.

---

## 0. Project Essentials

- **Framework**: Expo Router (file-based routing). Screens are in `app/`.
- **Styling**: Nativewind 4.x — use `className` on all React Native primitives.
- **Language**: TypeScript (strict). No `any` types. No `// @ts-ignore`.
- **Translations**: Import `useTranslation` from `i18n-js` — do not hardcode text strings. Use the keys listed below.
- **RTL**: Use `I18nManager.isRTL` for conditional direction. Do not assume LTR.
- **Navigation**: Use `useRouter()` from `expo-router` for navigation. Use `useLocalSearchParams()` to read URL params.

---

## 1. Available Components & What They Accept

### `src/components/ui/Button.tsx`
```tsx
import { Button } from '../../src/components/ui/Button';

<Button
  label="string"           // REQUIRED — button text
  variant="primary"        // "primary" | "secondary" | "outline"
  isLoading={false}        // shows ActivityIndicator when true
  onPress={() => {}}       // TouchableOpacity handler
  disabled={false}         // disables + dims the button
  className="..."          // additional Nativewind classes
/>
```

### `src/components/ui/Input.tsx`
```tsx
import { Input } from '../../src/components/ui/Input';

<Input
  label="string"           // REQUIRED — shows above the field
  value="string"           // REQUIRED — controlled value
  onChangeText={(v) => {}} // REQUIRED — change handler
  error="string"           // optional red error below field
  placeholder="..."
  secureTextEntry={false}
  keyboardType="default"
  // ...any TextInput prop
/>
```

### `src/components/ui/Card.tsx`
```tsx
import { Card } from '../../src/components/ui/Card';

<Card className="...">   // wraps children in a white rounded shadow card
  {children}
</Card>
```

### `src/components/cards/BalanceDisplay.tsx`
```tsx
import { BalanceDisplay } from '../../src/components/cards/BalanceDisplay';

<BalanceDisplay
  balance={250.00}         // REQUIRED — number
  currency="₪"            // optional, defaults to "₪"
  isPoints={false}        // if true, shows integer + "points" label
/>
```
**Note**: `currency` prop is a symbol string (e.g. `"₪"`, `"$"`). For ILS use `"₪"`. Map currencies → symbols yourself.

### `src/components/cards/ExpiryBadge.tsx`
```tsx
import { ExpiryBadge } from '../../src/components/cards/ExpiryBadge';

<ExpiryBadge
  date="31/12/2025"        // REQUIRED — display string
  daysUntil={45}           // REQUIRED — integer. ≤30 triggers red style
/>
```
**Note**: Compute `daysUntil` as `Math.ceil((new Date(card.valid_until).getTime() - Date.now()) / 86400000)`.

### `src/components/cards/CardForm.tsx`
```tsx
import { CardForm } from '../../src/components/cards/CardForm';

<CardForm
  mode="create"            // "create" | "edit"
  initialValues={{}}       // optional Partial<GiftCardFormValues>
  cardId="..."             // required when mode="edit"
  onSuccess={(card) => {}} // called with GiftCard after save
  onCancel={() => {}}      // called when user taps Cancel
/>
```

---

## 2. Available Hooks

All hooks are in `src/hooks/useGiftCards.ts`. Import exactly as shown.

```ts
import {
  useGiftCards,
  useGiftCard,
  useGiftCardStats,
  useAddGiftCard,       // NOT used directly in UI — CardForm handles this
  useUpdateGiftCard,    // NOT used directly in UI — CardForm handles this
  useDeleteGiftCard,
  useToggleFavorite,
  useArchiveGiftCard,
} from '../../src/hooks/useGiftCards';
```

### `useGiftCards(filters?, sort?, options?)`
```ts
const { data: cards, isLoading, isError, refetch } = useGiftCards(
  { is_archived: false },  // CardFilters
  'recent',                // CardSortOrder: 'recent' | 'expiring_soon' | 'highest_balance' | 'alphabetical'
);
// cards: GiftCard[] | undefined
```

### `useGiftCard(id)`
```ts
const { data: card, isLoading, isError } = useGiftCard(id);
// card: GiftCard | null | undefined
```

### `useGiftCardStats(currency?)`
```ts
const { data: stats } = useGiftCardStats('ILS');
// stats: { totalActiveCards: number, totalBalance: number, expiringWithin30Days: number, currency: string } | undefined
```

### `useDeleteGiftCard()`
```ts
const { mutate: deleteCard, isPending } = useDeleteGiftCard();
deleteCard(cardId);  // takes a string id
```

### `useToggleFavorite()`
```ts
const { mutate: toggleFavorite } = useToggleFavorite();
toggleFavorite(cardId, currentIsFavoriteValue);  // (id: string, currentValue: boolean)
```

### `useArchiveGiftCard()`
```ts
const { mutate: archiveCard } = useArchiveGiftCard();
archiveCard(cardId, true);   // archive
archiveCard(cardId, false);  // unarchive
```

---

## 3. Types

```ts
import type { GiftCard, CardType, CardCategory, CardFilters, CardSortOrder } from '../../src/types/gift-card';
```

Key fields on `GiftCard` you'll use in the UI:
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | UUID |
| `brand_name` | `string` | Display name |
| `card_type` | `CardType` | `'gift_card' \| 'loyalty' \| 'voucher' \| 'prepaid'` |
| `code` | `string \| null` | Encrypted — display as `••••••` unless decrypted |
| `pin` | `string \| null` | Encrypted — same as code |
| `current_balance` | `number \| null` | Monetary balance |
| `points_balance` | `number \| null` | Loyalty points |
| `currency` | `string` | e.g. `'ILS'` |
| `valid_until` | `string \| null` | ISO 8601 date string |
| `is_favorite` | `boolean` | |
| `is_archived` | `boolean` | |
| `color` | `string` | Color name: `'blue'`, `'green'`, `'red'`, `'purple'`, `'orange'`, `'pink'`, `'teal'`, `'gray'` |
| `category` | `CardCategory` | |
| `notes` | `string \| null` | |

---

## 4. Auth Store

```ts
import { useAuthStore } from '../../src/stores/authStore';

const user = useAuthStore((s) => s.user);
// user: { id, email, displayName, preferredCurrency, language } | null
```

---

## 5. Translations — Exact i18n Keys

The locale files are at `src/locales/he.json` and `src/locales/en.json`.

**Currently defined keys:**
```
dashboard.title            → "My Cards" / "הכרטיסים שלי"
dashboard.totalBalance     → "Total Balance" / "יתרה כוללת"
dashboard.expiringSoon     → "Expiring Soon" / "פג תוקף בקרוב"
dashboard.addCard          → "Add Card" / "הוסף כרטיס"
dashboard.activeCards      → "Active Cards" / "כרטיסים פעילים"
addCard.title              → "Add New Card" / "הוסף כרטיס חדש"
addCard.save               → "Save Card" / "שמור כרטיס"
```

**For strings not in the locale files**, add them to BOTH `he.json` and `en.json` before using them. Never hardcode display text.

Use translations like this:
```ts
import { I18n } from 'i18n-js';
import he from '../../src/locales/he.json';
import en from '../../src/locales/en.json';
import { useAuthStore } from '../../src/stores/authStore';

// At the top of each screen component:
const i18n = new I18n({ he, en });
const language = useAuthStore((s) => s.user?.language ?? 'he');
i18n.locale = language;

// Usage:
i18n.t('dashboard.title')
```

---

## 6. Color Mapping

To display a card with its color, map the `color` string to a Tailwind background class:
```ts
const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-600',
  green:  'bg-green-600',
  red:    'bg-red-600',
  purple: 'bg-purple-600',
  orange: 'bg-orange-600',
  pink:   'bg-pink-600',
  teal:   'bg-teal-600',
  gray:   'bg-gray-600',
};
// Usage: <View className={COLOR_MAP[card.color] ?? 'bg-blue-600'} />
```

---

## 7. SCREEN 1 — `app/(tabs)/index.tsx` (Dashboard)

### Route
File: `app/(tabs)/index.tsx`  
This is the default tab — the user's home screen.

### What to build
A scrollable screen showing:
1. **Stats bar** at the top: total balance, active card count, expiring soon count.
2. **Expiring soon section**: horizontal scroll of cards with `valid_until` within 30 days.
3. **Card grid**: 2-column `FlatList` of all active (non-archived) cards.
4. **FAB** (Floating Action Button): bottom-right "+" button to add a card.

### Exact implementation

```tsx
'use client'; // Not needed in RN but harmless
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { I18n } from 'i18n-js';

import { useGiftCards, useGiftCardStats } from '../../src/hooks/useGiftCards';
import { useAuthStore } from '../../src/stores/authStore';
import { Card } from '../../src/components/ui/Card';
import { BalanceDisplay } from '../../src/components/cards/BalanceDisplay';
import { ExpiryBadge } from '../../src/components/cards/ExpiryBadge';
import type { GiftCard, CardSortOrder } from '../../src/types/gift-card';
import he from '../../src/locales/he.json';
import en from '../../src/locales/en.json';
```

#### Stats Bar Component (inline in the same file)
```tsx
function StatsBar() {
  const currency = useAuthStore((s) => s.user?.preferredCurrency ?? 'ILS');
  const { data: stats, isLoading } = useGiftCardStats(currency);

  if (isLoading) return <View className="h-20 bg-gray-50 animate-pulse rounded-2xl mx-4 mb-4" />;

  return (
    <View className="flex-row mx-4 mb-4 gap-3">
      <Card className="flex-1 items-center py-3">
        <Text className="text-xs text-gray-500 mb-1">{/* i18n: dashboard.totalBalance */}</Text>
        <Text className="text-lg font-bold text-gray-900">
          ₪{stats?.totalBalance.toFixed(0) ?? '0'}
        </Text>
      </Card>
      <Card className="flex-1 items-center py-3">
        <Text className="text-xs text-gray-500 mb-1">{/* i18n: dashboard.activeCards */}</Text>
        <Text className="text-lg font-bold text-gray-900">{stats?.totalActiveCards ?? 0}</Text>
      </Card>
      <Card className="flex-1 items-center py-3">
        <Text className="text-xs text-gray-500 mb-1">{/* i18n: dashboard.expiringSoon */}</Text>
        <Text className={`text-lg font-bold ${(stats?.expiringWithin30Days ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
          {stats?.expiringWithin30Days ?? 0}
        </Text>
      </Card>
    </View>
  );
}
```

#### Card Grid Item (inline in the same file)
```tsx
function CardGridItem({ card, onPress }: { card: GiftCard; onPress: () => void }) {
  const COLOR_MAP: Record<string, string> = {
    blue: 'bg-blue-600', green: 'bg-green-600', red: 'bg-red-600',
    purple: 'bg-purple-600', orange: 'bg-orange-600', pink: 'bg-pink-600',
    teal: 'bg-teal-600', gray: 'bg-gray-600',
  };

  const daysUntil = card.valid_until
    ? Math.ceil((new Date(card.valid_until).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <TouchableOpacity onPress={onPress} className="flex-1 m-1" activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`View ${card.brand_name} card`}>
      <View className={`${COLOR_MAP[card.color] ?? 'bg-blue-600'} rounded-2xl p-4 min-h-32`}>
        <Text className="text-white font-bold text-base mb-1" numberOfLines={1}>
          {card.brand_name}
        </Text>
        {card.card_type !== 'loyalty' && card.current_balance != null && (
          <BalanceDisplay
            balance={card.current_balance}
            currency={card.currency === 'ILS' ? '₪' : card.currency}
          />
        )}
        {card.card_type === 'loyalty' && card.points_balance != null && (
          <BalanceDisplay balance={card.points_balance} isPoints />
        )}
        {daysUntil !== null && (
          <View className="mt-2">
            <ExpiryBadge
              date={card.valid_until!.slice(0, 10)}
              daysUntil={daysUntil}
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
```

#### Main Screen
```tsx
export default function DashboardScreen() {
  const router = useRouter();
  const language = useAuthStore((s) => s.user?.language ?? 'he');
  const i18n = new I18n({ he, en });
  i18n.locale = language;

  const [sort, setSort] = useState<CardSortOrder>('recent');
  const { data: cards, isLoading, isError, refetch } = useGiftCards({ is_archived: false }, sort);

  // Cards expiring within 30 days for the alert strip
  const expiringCards = (cards ?? []).filter((c) => {
    if (!c.valid_until) return false;
    const days = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86400000);
    return days <= 30;
  });

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-2xl font-bold text-gray-900">{i18n.t('dashboard.title')}</Text>
        {/* Optional: sort picker icon here */}
      </View>

      {/* Stats Bar */}
      <StatsBar />

      {/* Expiring Soon Strip */}
      {expiringCards.length > 0 && (
        <View className="mb-3">
          <Text className="text-sm font-semibold text-red-600 px-4 mb-2">
            {i18n.t('dashboard.expiringSoon')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 gap-3">
            {expiringCards.map((card) => {
              const days = Math.ceil((new Date(card.valid_until!).getTime() - Date.now()) / 86400000);
              return (
                <TouchableOpacity
                  key={card.id}
                  onPress={() => router.push(`/card/${card.id}`)}
                  className="bg-red-50 border border-red-200 rounded-xl p-3 w-36"
                  accessibilityLabel={`${card.brand_name} expires in ${days} days`}
                >
                  <Text className="font-semibold text-gray-900 text-sm" numberOfLines={1}>{card.brand_name}</Text>
                  <ExpiryBadge date={card.valid_until!.slice(0, 10)} daysUntil={days} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Card Grid */}
      {isLoading ? (
        <ActivityIndicator className="mt-12" size="large" color="#2563EB" />
      ) : isError ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500">Failed to load cards.</Text>
        </View>
      ) : (cards ?? []).length === 0 ? (
        /* Empty state */
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-5xl mb-4">🎁</Text>
          <Text className="text-xl font-bold text-gray-900 mb-2">No cards yet</Text>
          <Text className="text-gray-500 text-center mb-6">Add your first gift card or loyalty card to get started.</Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerClassName="px-3 pb-24"
          renderItem={({ item }) => (
            <CardGridItem card={item} onPress={() => router.push(`/card/${item.id}`)} />
          )}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB — Add Card */}
      <TouchableOpacity
        className="absolute bottom-8 right-6 w-14 h-14 bg-blue-600 rounded-full items-center justify-center shadow-lg shadow-blue-600/50"
        onPress={() => router.push('/card/add')}
        accessibilityRole="button"
        accessibilityLabel={i18n.t('dashboard.addCard')}
      >
        <Text className="text-white text-3xl leading-none font-light">+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
```

---

## 8. SCREEN 2 — `app/card/add.tsx` (Add Card)

### Route
File: `app/card/add.tsx`  
Navigated to via `router.push('/card/add')` or the FAB on the dashboard.

### What to build
A full-screen wrapper around `CardForm` with a back button and title.
**Do not replicate any form logic — just render `<CardForm />`.**

### Exact implementation

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { I18n } from 'i18n-js';

import { CardForm } from '../../src/components/cards/CardForm';
import { useAuthStore } from '../../src/stores/authStore';
import type { GiftCard } from '../../src/types/gift-card';
import he from '../../src/locales/he.json';
import en from '../../src/locales/en.json';

export default function AddCardScreen() {
  const router = useRouter();
  const language = useAuthStore((s) => s.user?.language ?? 'he');
  const i18n = new I18n({ he, en });
  i18n.locale = language;

  function handleSuccess(card: GiftCard) {
    // Navigate to the new card's detail page
    router.replace(`/card/${card.id}`);
  }

  function handleCancel() {
    router.back();
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Screen header */}
      <View className="flex-row items-center px-4 py-3 border-b border-gray-200 bg-white">
        <Text className="text-xl font-bold text-gray-900 flex-1">
          {i18n.t('addCard.title')}
        </Text>
      </View>

      {/* The form handles all validation, encryption, and saving */}
      <CardForm
        mode="create"
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </SafeAreaView>
  );
}
```

**That's it. Do NOT add any form inputs here. `CardForm` handles everything.**

---

## 9. SCREEN 3 — `app/card/[id].tsx` (Card Detail)

### Route
File: `app/card/[id].tsx`  
Navigated to via `router.push(`/card/${card.id}`)`.

Read the card ID with:
```ts
const { id } = useLocalSearchParams<{ id: string }>();
```

### What to build
A detail view for a single card showing all card info and actions.

### Layout (top to bottom)
1. **Header card** — colored background with brand name, code (masked), balance.
2. **Metadata section** — expiry, category, card type, notes.
3. **Actions section** — Favorite toggle, Archive button, Delete button, Edit button.
4. **Usage history** — placeholder `<Text>` saying "Usage history coming soon" (Phase 1, not built yet).

### Encryption note
`card.code`, `card.pin`, and `card.card_number` are stored **encrypted** in the database. The format is a string starting with `enc:v1:`. 

**DO NOT try to decrypt in the UI.** Simply show them masked as `••••••••` in a `<Text>` with a "Copy" button that copies the raw (still-encrypted) value to clipboard — actual decryption is a Phase 2 feature.

If you want to show "card has a code", check: `!!card.code` — if truthy, show the masked display. Do NOT call any function from `encryption.ts`.

### Exact implementation

```tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { I18n } from 'i18n-js';

import { useGiftCard, useDeleteGiftCard, useToggleFavorite, useArchiveGiftCard } from '../../src/hooks/useGiftCards';
import { useAuthStore } from '../../src/stores/authStore';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { BalanceDisplay } from '../../src/components/cards/BalanceDisplay';
import { ExpiryBadge } from '../../src/components/cards/ExpiryBadge';
import type { GiftCard } from '../../src/types/gift-card';
import he from '../../src/locales/he.json';
import en from '../../src/locales/en.json';

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-600', green: 'bg-green-600', red: 'bg-red-600',
  purple: 'bg-purple-600', orange: 'bg-orange-600', pink: 'bg-pink-600',
  teal: 'bg-teal-600', gray: 'bg-gray-600',
};

export default function CardDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const language = useAuthStore((s) => s.user?.language ?? 'he');
  const i18n = new I18n({ he, en });
  i18n.locale = language;

  const { data: card, isLoading, isError } = useGiftCard(id);
  const { mutate: deleteCard, isPending: isDeleting } = useDeleteGiftCard();
  const { mutate: toggleFavorite } = useToggleFavorite();
  const { mutate: archiveCard } = useArchiveGiftCard();

  // --- Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  // --- Error / not found
  if (isError || !card) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-8">
        <Text className="text-xl font-bold text-gray-900 mb-2">Card not found</Text>
        <Button label="Go back" variant="outline" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  // --- Compute expiry info
  const daysUntil = card.valid_until
    ? Math.ceil((new Date(card.valid_until).getTime() - Date.now()) / 86400000)
    : null;

  // --- Handlers
  function handleDelete() {
    Alert.alert(
      'Delete Card',
      `Are you sure you want to delete ${card!.brand_name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteCard(card!.id, {
              onSuccess: () => router.replace('/(tabs)/'),
            });
          },
        },
      ],
    );
  }

  function handleArchiveToggle() {
    archiveCard(card!.id, !card!.is_archived);
  }

  function handleFavoriteToggle() {
    toggleFavorite(card!.id, card!.is_favorite);
  }

  function handleEdit() {
    router.push(`/card/edit/${card!.id}`);
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView contentContainerClassName="pb-10" showsVerticalScrollIndicator={false}>

        {/* ── Hero Card ───────────────────────────────────────────────── */}
        <View className={`${COLOR_MAP[card.color] ?? 'bg-blue-600'} px-6 pt-12 pb-8`}>
          {/* Back button */}
          <TouchableOpacity
            onPress={() => router.back()}
            className="absolute top-4 left-4 bg-white/20 rounded-full p-2"
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text className="text-white text-base">←</Text>
          </TouchableOpacity>

          {/* Favorite button */}
          <TouchableOpacity
            onPress={handleFavoriteToggle}
            className="absolute top-4 right-4 bg-white/20 rounded-full p-2"
            accessibilityLabel={card.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            accessibilityRole="button"
          >
            <Text className="text-xl">{card.is_favorite ? '★' : '☆'}</Text>
          </TouchableOpacity>

          <Text className="text-white text-2xl font-bold mb-1">{card.brand_name}</Text>
          <Text className="text-white/70 text-sm mb-4 capitalize">{card.card_type.replace('_', ' ')}</Text>

          {/* Balance */}
          {card.card_type !== 'loyalty' && card.current_balance != null && (
            <BalanceDisplay
              balance={card.current_balance}
              currency={card.currency === 'ILS' ? '₪' : card.currency}
            />
          )}
          {card.card_type === 'loyalty' && card.points_balance != null && (
            <BalanceDisplay balance={card.points_balance} isPoints />
          )}

          {/* Card code — show masked, tap to "copy" (copies encrypted value) */}
          {card.code && (
            <TouchableOpacity
              className="mt-4 bg-white/10 rounded-xl px-4 py-3 flex-row items-center justify-between"
              onPress={() => {
                Clipboard.setStringAsync(card.code!);
                Alert.alert('Copied', 'Card code copied to clipboard.');
              }}
              accessibilityLabel="Copy card code"
              accessibilityRole="button"
            >
              <Text className="text-white font-mono text-base tracking-widest">••••  ••••  ••••</Text>
              <Text className="text-white/70 text-xs">TAP TO COPY</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Metadata Card ───────────────────────────────────────────── */}
        <View className="px-4 pt-4">
          <Card className="mb-4">
            <Text className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Details</Text>

            <View className="gap-3">
              {/* Category */}
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-600 text-sm">Category</Text>
                <Text className="text-gray-900 font-medium text-sm capitalize">{card.category}</Text>
              </View>

              {/* Expiry */}
              {card.valid_until ? (
                <View className="flex-row items-center justify-between">
                  <Text className="text-gray-600 text-sm">Expires</Text>
                  <ExpiryBadge date={card.valid_until.slice(0, 10)} daysUntil={daysUntil ?? 0} />
                </View>
              ) : (
                <View className="flex-row items-center justify-between">
                  <Text className="text-gray-600 text-sm">Expires</Text>
                  <Text className="text-gray-400 text-sm">No expiry</Text>
                </View>
              )}

              {/* PIN indicator (never show value) */}
              {card.pin && (
                <View className="flex-row items-center justify-between">
                  <Text className="text-gray-600 text-sm">PIN</Text>
                  <Text className="text-gray-900 font-mono text-sm">••••</Text>
                </View>
              )}

              {/* Notes */}
              {card.notes && (
                <View>
                  <Text className="text-gray-600 text-sm mb-1">Notes</Text>
                  <Text className="text-gray-900 text-sm">{card.notes}</Text>
                </View>
              )}

              {/* Added date */}
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-600 text-sm">Added</Text>
                <Text className="text-gray-500 text-sm">{card.created_at.slice(0, 10)}</Text>
              </View>
            </View>
          </Card>

          {/* ── Usage History Placeholder ─────────────────────────── */}
          <Card className="mb-4">
            <Text className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Usage History</Text>
            <Text className="text-gray-400 text-sm text-center py-4">Usage history coming soon.</Text>
          </Card>

          {/* ── Actions ──────────────────────────────────────────── */}
          <View className="gap-3">
            <Button
              label="Edit Card"
              variant="outline"
              onPress={handleEdit}
              className="w-full"
              accessibilityLabel="Edit card"
            />
            <Button
              label={card.is_archived ? 'Unarchive Card' : 'Archive Card'}
              variant="secondary"
              onPress={handleArchiveToggle}
              className="w-full"
              accessibilityLabel={card.is_archived ? 'Unarchive card' : 'Archive card'}
            />
            <Button
              label="Delete Card"
              variant="outline"
              onPress={handleDelete}
              isLoading={isDeleting}
              className="w-full border-red-500"
              accessibilityLabel="Delete card"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

---

## 10. Dependencies to Install Before Running

Run this in the `gifty/` directory:
```bash
npx expo install zod expo-clipboard
npm install react-hook-form @hookform/resolvers
```

These packages are not in `package.json` yet and are required by `CardForm.tsx`.

---

## 11. Common Mistakes to Avoid

| ❌ Wrong | ✅ Correct |
|---|---|
| `import { useAddGiftCard } from 'useGiftCards'` | `import { useAddGiftCard } from '../../src/hooks/useGiftCards'` |
| `<BalanceDisplay currency="ILS" />` | `<BalanceDisplay currency="₪" />` (symbol, not code) |
| `deleteCard({ id: cardId })` | `deleteCard(cardId)` (takes a plain string) |
| `toggleFavorite(cardId)` | `toggleFavorite(cardId, card.is_favorite)` (two args) |
| `archiveCard(cardId)` | `archiveCard(cardId, true)` or `archiveCard(cardId, false)` |
| Calling any function from `encryption.ts` in the UI | Never call encryption helpers from screen files |
| Hardcoded Hebrew/English strings | Always use `i18n.t('key')` |
| `router.push('tabs/')` | `router.push('/(tabs)/')` |
| Using `useState` for remote data | Use the React Query hooks only |

---

## 12. File Checklist

When done, these files must exist:
- [ ] `app/(tabs)/index.tsx`
- [ ] `app/card/add.tsx`
- [ ] `app/card/[id].tsx`

Do NOT modify:
- `src/hooks/useGiftCards.ts`
- `src/services/encryption.ts`
- `src/components/cards/CardForm.tsx`
- `src/services/database.ts`
- Any file in `src/components/ui/`
- Any locale file
- `package.json` (use the install commands from section 10 only)

---

*Generated by the logic agent (gifty-logic subagent). Questions? Re-read this file carefully before asking.*
