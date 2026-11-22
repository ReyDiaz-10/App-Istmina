import { AppText as Text, AppTextInput as TextInput } from './AppText.js';
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
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
  onTransferBalance,
}) {
  const { colors } = useAppTheme();
  const locale = usePreferencesStore((state) => state.language);
  const [topUpAmount, setTopUpAmount] = useState('20000');
  const parsedTopUpAmount = Number(topUpAmount);
  const validTopUpAmount = Number.isSafeInteger(parsedTopUpAmount) && parsedTopUpAmount >= 20000;

  const handleTopUp = () => {
    if (!validTopUpAmount) {
      Alert.alert('Monto mínimo', 'La recarga de billetera debe ser de al menos $20.000 COP.');
      return;
    }
    onTopUp?.(parsedTopUpAmount);
  };
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
      <Text style={[styles.description, { color: colors.muted }]}>Recarga mínima: $20.000 COP. Puedes ingresar un valor mayor.</Text>
      {!subscriptionActive && Number(balance) <= 0 ? (
        <Text style={styles.warning}>
          No puedes recibir nuevos pedidos con saldo en cero. Recarga o activa Pro para continuar.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <TextInput
          accessibilityLabel="Valor de recarga de la billetera en pesos colombianos"
          value={topUpAmount}
          onChangeText={(value) => setTopUpAmount(value.replace(/\D/g, '').slice(0, 10))}
          placeholder="Monto de recarga en COP"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          style={[styles.amountInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
        />
        <AnimatedButton
          title={loading ? 'Abriendo pago...' : `Recargar ${formatCOP(parsedTopUpAmount, locale)}`}
          onPress={handleTopUp}
          disabled={loading || !validTopUpAmount}
          style={styles.action}
          buttonStyle={[styles.button, { backgroundColor: colors.primary, borderColor: colors.primary }]}
        />
        <AnimatedButton
          title="Transferir saldo a otro negocio"
          onPress={onTransferBalance}
          disabled={loading}
          variant="secondary"
          style={styles.action}
        />
        <AnimatedButton
          title={subscriptionActive ? 'Suscripción activa' : 'Suscribirme $50.000/mes'}
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
  amountInput: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, marginTop: 10 },
});
