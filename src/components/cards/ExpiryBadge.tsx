import React from 'react';
import { View, Text } from 'react-native';

interface ExpiryBadgeProps {
  date: string; // ISO format or short string
  daysUntil: number;
}

export function ExpiryBadge({ date, daysUntil }: ExpiryBadgeProps) {
  const isUrgent = daysUntil <= 30;
  
  return (
    <View className={`px-2 py-1 rounded-md self-start ${isUrgent ? 'bg-red-100' : 'bg-gray-100'}`}>
      <Text className={`text-xs font-semibold ${isUrgent ? 'text-red-600' : 'text-gray-600'}`}>
        {date}
      </Text>
    </View>
  );
}