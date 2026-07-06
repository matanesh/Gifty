import React from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <View className={`w-full mb-4 ${className}`}>
      <Text className="text-gray-700 text-sm mb-1 font-medium text-left">{label}</Text>
      <TextInput
        className={`w-full bg-white border rounded-xl px-4 py-3 text-base text-gray-900 text-left ${
          error ? 'border-red-500' : 'border-gray-300'
        } focus:border-blue-500`}
        placeholderTextColor="#9ca3af"
        {...props}
      />
      {error && <Text className="text-red-500 text-xs mt-1 text-left">{error}</Text>}
    </View>
  );
}