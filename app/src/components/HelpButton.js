import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export default function HelpButton({ navigation, context, orderId, compact = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Pedir ayuda o reportar un problema"
      onPress={() => navigation.navigate('Support', { context, orderId })}
      style={[styles.button, compact && styles.compact]}
    >
      <Text style={styles.text}>{compact ? 'Ayuda' : '¿Algo salió mal? Pedir ayuda'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'stretch', backgroundColor: '#FFF7E6', borderColor: '#E0A126', borderWidth: 1, borderRadius: 12, padding: 13, marginVertical: 10, alignItems: 'center' },
  compact: { alignSelf: 'center', paddingHorizontal: 18 },
  text: { color: '#704B00', fontWeight: '700' },
});
