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
