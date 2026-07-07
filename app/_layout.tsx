import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import '../global.css';

import { initDatabase, ensureLocalMvpUser } from '../src/services/database';
import { useAuthStore } from '../src/stores/authStore';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const [isReady, setIsReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapLocalMvp() {
      try {
        await initDatabase();
        await ensureLocalMvpUser();
        setUser({
          id: 'local-user',
          email: 'local@gifty.app',
          displayName: 'Local User',
          preferredCurrency: 'ILS',
          language: 'he',
          isBiometricUnlocked: true,
        });
        if (isMounted) setIsReady(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start Gifty';
        if (isMounted) setStartupError(message);
      }
    }

    bootstrapLocalMvp();

    return () => {
      isMounted = false;
    };
  }, [setUser]);

  if (startupError) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-lg font-bold text-gray-900 mb-2">Gifty failed to start</Text>
        <Text className="text-sm text-gray-600 text-center">{startupError}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
