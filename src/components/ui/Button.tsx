import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'outline';
  isLoading?: boolean;
}

export function Button({ label, variant = 'primary', isLoading, className = '', ...props }: ButtonProps) {
  const baseStyles = "py-3 px-6 rounded-xl flex-row justify-center items-center";
  const variants = {
    primary: "bg-blue-600",
    secondary: "bg-gray-200",
    outline: "border-2 border-blue-600 bg-transparent"
  };

  const textStyles = {
    primary: "text-white font-bold text-base",
    secondary: "text-gray-900 font-bold text-base",
    outline: "text-blue-600 font-bold text-base"
  };

  return (
    <TouchableOpacity 
      className={`${baseStyles} ${variants[variant]} ${isLoading || props.disabled ? 'opacity-50' : ''} ${className}`}
      disabled={isLoading || props.disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      {...props}
    >
      {isLoading ? (
        <ActivityIndicator color={variant === 'outline' ? '#2563eb' : '#ffffff'} />
      ) : (
        <Text className={textStyles[variant]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}