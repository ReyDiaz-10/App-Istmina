import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AnimatedButton from '../../components/AnimatedButton';
import OrderChat from '../../components/OrderChat';
import { useAppTheme } from '../../hooks/useAppTheme';

const OrderChatScreen = ({ route, navigation }) => {
  const { orderId } = route.params || {};
  const { colors } = useAppTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <AnimatedButton variant="back" navigation={navigation} />
        <Text style={[styles.title, { color: colors.text }]}>Chat del pedido</Text>
        <AnimatedButton variant="home" navigation={navigation} />
      </View>
      {orderId ? (
        <OrderChat orderId={orderId} navigation={navigation} />
      ) : (
        <Text style={[styles.error, { color: colors.muted }]}>No se encontró el pedido para abrir el chat.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222222' },
  error: { padding: 20, color: '#B00020' },
});

export default OrderChatScreen;
