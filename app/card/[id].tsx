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
              onSuccess: () => router.replace('/(tabs)'),
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
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

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
