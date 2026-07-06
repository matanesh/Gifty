import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import he from '../../src/locales/he.json';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const t = he.login;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-center px-6"
      >
        <View className="mb-8">
          <Text className="text-3xl font-bold text-gray-900 text-center mb-2">Gifty</Text>
          <Text className="text-lg text-gray-500 text-center">{t.title}</Text>
        </View>

        <View className="w-full">
          <Input 
            label={t.email}
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          
          <Input 
            label={t.password}
            placeholder="********"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          
          <Button 
            label={t.submit} 
            className="mt-4"
            onPress={() => console.log('Login pressed')} 
          />
        </View>

        <View className="mt-6 items-center">
          <Text className="text-blue-600 font-medium">
            {t.noAccount}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}