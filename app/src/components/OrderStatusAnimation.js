import { AppText as Text } from './AppText.js';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

const STATUS_CONTENT = {
  pendiente: { icon: '💳', label: 'Esperando confirmación del pago' },
  pagado: { icon: '✅', label: 'Pago confirmado. El negocio recibió tu pedido.' },
  preparando: { icon: '👩‍🍳', label: 'El negocio está preparando tu pedido' },
  listo_para_repartidor: { icon: '📦', label: 'Tu pedido está listo para recoger' },
  repartidor_asignado: { icon: '🛵', label: 'El repartidor va hacia el negocio para recogerlo' },
  recogido: { icon: '🛵', label: 'El repartidor recogió tu pedido y se dirige a tu domicilio' },
  en_camino: { icon: '🛵', label: 'Tu repartidor va en camino a tu domicilio' },
  no_entregado: { icon: '⚠️', label: 'No se pudo entregar. El pedido debe regresar al negocio para su resolución.' },
  entregado: { icon: '🎉', label: 'Pedido entregado. ¡Buen provecho!' },
  cancelado: { icon: '⚠️', label: 'Este pedido fue cancelado' },
};

export default function OrderStatusAnimation({ status, driverAssignedToPreparing = false }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [trackWidth, setTrackWidth] = useState(0);
  const headingToBusiness = status === 'repartidor_asignado'
    || (status === 'preparando' && driverAssignedToPreparing);
  const headingToHome = status === 'recogido' || status === 'en_camino';
  const isOnRoute = headingToBusiness || headingToHome;
  const content = headingToBusiness
    ? { icon: '🛵', label: 'El repartidor va hacia el negocio mientras se prepara el pedido' }
    : headingToHome && status === 'recogido'
      ? STATUS_CONTENT.recogido
      : STATUS_CONTENT[status] || STATUS_CONTENT.pendiente;

  useEffect(() => {
    progress.setValue(0);
    if (!isOnRoute) return undefined;

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 3600,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [headingToBusiness, headingToHome, isOnRoute, progress]);

  const iconAnimationStyle = {
    transform: [{
      rotate: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [isOnRoute ? '-4deg' : '-8deg', isOnRoute ? '4deg' : '8deg'],
      }),
    }],
  };
  const courierAnimationStyle = {
    transform: [{
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.max(0, trackWidth - 26)],
      }),
    }],
  };

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Animated.Text style={[styles.icon, iconAnimationStyle]}>{content.icon}</Animated.Text>
      <Text style={styles.label}>{content.label}</Text>
      {isOnRoute ? (
        <View style={styles.route}>
          <View style={styles.routeLabels}>
            <Text style={styles.routeEndpoint}>{headingToBusiness ? 'Repartidor' : 'Negocio'}</Text>
            <Text style={styles.routeEndpoint}>
              {headingToBusiness ? '🏪 Negocio' : '🏠 Casa'}
            </Text>
          </View>
          <View
            style={styles.routeTrack}
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          >
            <View style={styles.routeLine} />
            <Animated.Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[
                styles.routeCourier,
                courierAnimationStyle,
              ]}
            >🛵</Animated.Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 76,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  icon: { fontSize: 34, marginRight: 12 },
  label: { flex: 1, color: '#333333', fontSize: 15, fontWeight: '600' },
  route: { flexBasis: '100%', marginLeft: 46, marginTop: 8, marginRight: 8 },
  routeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  routeEndpoint: { color: '#475467', fontSize: 12, fontWeight: '800' },
  routeTrack: { height: 30, justifyContent: 'center' },
  routeLine: { height: 4, backgroundColor: '#C6A64B', borderRadius: 2 },
  routeCourier: { position: 'absolute', left: 0, top: -3, fontSize: 24 },
});
