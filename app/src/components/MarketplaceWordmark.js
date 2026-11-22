import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const wordmark = require('../../assets/images/istmiya-wordmark-high-contrast.png');

export default function MarketplaceWordmark({ width = 220, style }) {
  const height = width * (266 / 1200);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="IstmiYa, mercado local"
      style={[styles.plate, { width, height }, style]}
    >
      <Image source={wordmark} resizeMode="contain" style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#FFF4E2',
  },
  image: { width: '100%', height: '100%' },
});
