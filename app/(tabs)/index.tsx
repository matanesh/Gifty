'use client';
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

export default function DashboardScreen() {
  const router = useRouter();
  const language = useAuthStore((s) => s.user?.language ?? 'he');
  const i18n = new I18n({ he, en });
  i18n.locale = language;

  const [sort, setSort] = useState<CardSortOrder>('recent');
  const { data: cards, isLoading, isError, refetch } = useGiftCards({ is_archived: false }, sort);

  const expiringCards = (cards ?? []).filter((c) => {
    if (!c.valid_until) return false;
    const days = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86400000);
    return days <= 30;
  });

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-2xl font-bold text-gray-900">{i18n.t('dashboard.title')}</Text>
      </View>

      <StatsBar />

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

      {isLoading ? (
        <ActivityIndicator className="mt-12" size="large" color="#2563EB" />
      ) : isError ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500">Failed to load cards.</Text>
        </View>
      ) : (cards ?? []).length === 0 ? (
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
