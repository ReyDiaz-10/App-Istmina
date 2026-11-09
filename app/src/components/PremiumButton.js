// app/src/components/PremiumButton.js
import React, { useRef } from 'react';
import { Pressable, Text, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

const PremiumButton = ({ onPress, title, style, textStyle }) => {
  // Valor animado para la escala (1 = tamaño normal, 0.95 = hundido)
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    // Feedback táctil ligero
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Animación de hundimiento (Spring para efecto elástico)
    Animated.spring(scaleValue, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  const handlePressOut = () => {
    // Regresa al tamaño original
    Animated.spring(scaleValue, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ scale: scaleValue }] }, style]}>
      <Pressable 
        onPressIn={handlePressIn} 
        onPressOut={handlePressOut} 
        onPress={onPress}
        style={styles.pressable}
      >
        <Text style={[styles.text, textStyle]}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 15,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  pressable: {
    backgroundColor: '#1A237E',
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default PremiumButton;
