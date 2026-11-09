// app/src/components/AlertBanner.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const AlertBanner = ({ expiresAt, onRenew }) => {
  if (!expiresAt) return null;

  const now = new Date();
  const expiryDate = new Date(expiresAt);
  const diffDays = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

  // Solo mostrar si faltan 3 días o menos (incluyendo días de gracia negativos)
  if (diffDays > 3) return null;

  const isGracePeriod = diffDays <= 0;

  return (
    <View style={[styles.banner, isGracePeriod ? styles.urgent : styles.warning]}>
      <Text style={styles.text}>
        {isGracePeriod 
          ? '⚠️ Tu suscripción ha vencido. Estás en periodo de gracia.' 
          : `⏳ Tu suscripción vence en ${diffDays} días.`}
      </Text>
      <TouchableOpacity style={styles.btn} onPress={onRenew}>
        <Text style={styles.btnText}>Renovar Ahora</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: { padding: 15, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: 15 },
  warning: { backgroundColor: '#FFF9C4', borderColor: '#FBC02D', borderWidth: 1 },
  urgent: { backgroundColor: '#FFCDD2', borderColor: '#D32F2F', borderWidth: 1 },
  text: { flex: 1, fontSize: 13, color: '#333', fontWeight: '600' },
  btn: { backgroundColor: '#1A237E', padding: 8, borderRadius: 5, marginLeft: 10 },
  btnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
});

export default AlertBanner;
