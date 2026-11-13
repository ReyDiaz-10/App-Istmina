import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const marketplaceMark = require('../../assets/images/istmiya-adaptive-foreground.png');

export default function MarketplaceBrand({ size = 58 }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Bolsa de compras con productos de IstmiYa" style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image source={marketplaceMark} resizeMode="contain" style={{ width: size * 0.84, height: size * 0.84 }} />
    </View>
  );
}

const styles = StyleSheet.create({ badge: { alignSelf: 'center', backgroundColor: '#FFF4E2', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
