import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const STATUS_CONTENT = {
  pendiente: { icon: '💳', label: 'Esperando confirmación del pago' },
  pagado: { icon: '✅', label: 'Pago confirmado. El negocio recibió tu pedido.' },
  preparando: { icon: '👩‍🍳', label: 'El negocio está preparando tu pedido' },
  listo_para_repartidor: { icon: '📦', label: 'Tu pedido está listo para recoger' },
  en_camino: { icon: '🛵', label: 'Tu repartidor va en camino' },
  entregado: { icon: '🎉', label: 'Pedido entregado. ¡Buen provecho!' },
  cancelado: { icon: '⚠️', label: 'Este pedido fue cancelado' },
};

export default function OrderStatusAnimation({ status }) {
  const progress = useRef(new Animated.Value(0)).current;
  const content = STATUS_CONTENT[status] || STATUS_CONTENT.pendiente;

  useEffect(() => {
    progress.setValue(0);
    if (status !== 'preparando' && status !== 'en_camino') return undefined;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: status === 'en_camino' ? 1000 : 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: status === 'en_camino' ? 1000 : 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, status]);

  const animatedStyle = status === 'en_camino'
    ? {
      transform: [{
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-12, 12],
        }),
      }],
    }
    : {
      transform: [{
        rotate: progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['-8deg', '8deg'],
        }),
      }],
    };

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Animated.Text style={[styles.icon, animatedStyle]}>{content.icon}</Animated.Text>
      <Text style={styles.label}>{content.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  icon: { fontSize: 34, marginRight: 12 },
  label: { flex: 1, color: '#333333', fontSize: 15, fontWeight: '600' },
});
