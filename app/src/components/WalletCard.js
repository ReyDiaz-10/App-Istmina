import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AnimatedButton from './AnimatedButton';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePreferencesStore } from '../store/preferencesStore';
import { formatCOP } from '../utils/formatters';

export default function WalletCard({
  balance,
  subscriptionActive,
  loading = false,
  onTopUp,
  onSubscribe,
}) {
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Billetera del negocio</Text>
      <Text style={[styles.balance, { color: colors.text }]}>
        {formatCOP(balance, locale)}
      </Text>
      <Text style={[styles.subscription, { color: colors.muted }]}>
        Suscripción mensual: {subscriptionActive ? 'Activa' : 'Inactiva'}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Sin suscripción se descuenta una comisión del 10% al aceptar cada pedido.
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Este saldo es un prepago para comisiones; no representa ventas pendientes de retiro.
      </Text>
      {!subscriptionActive && Number(balance) <= 0 ? (
        <Text style={styles.warning}>
          No puedes recibir nuevos pedidos con saldo en cero. Recarga o activa Pro para continuar.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <AnimatedButton
          title={loading ? 'Abriendo pago...' : 'Recargar $50.000'}
          onPress={onTopUp}
          disabled={loading}
          style={styles.action}
          buttonStyle={[styles.button, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        />
        <AnimatedButton
          title={subscriptionActive ? 'Suscripción activa' : 'Suscribirme $35.000/mes'}
          onPress={onSubscribe}
          disabled={loading || subscriptionActive}
          style={styles.action}
          buttonStyle={[styles.button, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, borderRadius: 18, marginBottom: 20, borderWidth: 1 },
  title: { fontSize: 17, fontWeight: '700' },
  balance: { fontSize: 30, fontWeight: '800', marginTop: 12 },
  subscription: { fontSize: 14, marginTop: 8, fontWeight: '600' },
  description: { fontSize: 13, marginTop: 8, lineHeight: 19 },
  warning: { color: '#B3261E', fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 10 },
  actions: { marginTop: 14 },
  action: { alignSelf: 'stretch', marginTop: 8 },
  button: { width: '100%', backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
});
