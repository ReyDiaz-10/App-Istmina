import React, { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useRoleTheme } from '../hooks/useRoleTheme';

const VARIANT_CONTENT = {
  back: { icon: '‹', title: 'Atrás' },
  home: { icon: '⌂', title: 'Inicio' },
};

export default function AnimatedButton({
  title,
  variant = 'primary',
  onPress,
  disabled = false,
  style,
  buttonStyle,
  textStyle,
  accessibilityLabel,
  navigation,
  ...pressableProps
}) {
  const theme = useRoleTheme();
  const [scale] = useState(() => new Animated.Value(1));
  const utilityContent = VARIANT_CONTENT[variant];
  const label = title || utilityContent?.title || '';
  const isPrimary = variant === 'primary';
  const foregroundColor = isPrimary ? theme.onPrimary : theme.primary;

  const animateScale = (toValue) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: Platform.OS !== 'web',
      speed: 24,
      bounciness: 4,
    }).start();
  };

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (variant === 'back') {
      if (navigation?.canGoBack()) {
        navigation.goBack();
      } else {
        navigation?.navigate('ClientHome');
      }
    } else if (variant === 'home') {
      navigation?.navigate('ClientHome');
    }
  };

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale }] }, style]}>
      <Pressable
        {...pressableProps}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        disabled={disabled}
        onPress={handlePress}
        onPressIn={() => !disabled && animateScale(0.96)}
        onPressOut={() => animateScale(1)}
        style={({ pressed }) => [
          styles.button,
          isPrimary
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { backgroundColor: '#FFFFFF', borderColor: theme.primary },
          disabled && styles.disabled,
          pressed && styles.pressed,
          buttonStyle,
        ]}
      >
        {utilityContent && (
          <Text style={[styles.icon, { color: foregroundColor }]}>{utilityContent.icon}</Text>
        )}
        <Text style={[styles.text, { color: foregroundColor }, textStyle]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'flex-start',
  },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: 1,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
  },
  icon: {
    fontSize: 23,
    lineHeight: 23,
    marginRight: 6,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.92,
  },
});
