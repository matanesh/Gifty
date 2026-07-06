import React from 'react';
import { View, Text } from 'react-native';

interface BalanceDisplayProps {
  balance: number;
  currency?: string;
  isPoints?: boolean;
}

export function BalanceDisplay({ balance, currency = '₪', isPoints = false }: BalanceDisplayProps) {
  return (
    <View className="flex-row items-end">
      <Text className="text-2xl font-bold text-gray-900">
        {isPoints ? balance.toLocaleString() : `${currency}${balance.toFixed(2)}`}
      </Text>
      {isPoints && <Text className="text-sm text-gray-500 ml-1 mb-1">points</Text>}
    </View>
  );
}