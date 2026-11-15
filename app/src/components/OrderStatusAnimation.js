import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const STATUS_CONTENT = {
  pendiente: { icon: '💳', label: 'Esperando confirmación del pago' },
  pagado: { icon: '✅', label: 'Pago confirmado. El negocio recibió tu pedido.' },
  preparando: { icon: '👩‍🍳', label: 'El negocio está preparando tu pedido' },
  listo_para_repartidor: { icon: '📦', label: 'Tu pedido está listo para recoger' },
  repartidor_asignado: { icon: '🛵', label: 'El repartidor va hacia el negocio para recogerlo' },
  recogido: { icon: '📦', label: 'El repartidor recogió tu pedido' },
  en_camino: { icon: '🛵', label: 'Tu repartidor va en camino' },
  entregado: { icon: '🎉', label: 'Pedido entregado. ¡Buen provecho!' },
  cancelado: { icon: '⚠️', label: 'Este pedido fue cancelado' },
};

export default function OrderStatusAnimation({ status }) {
  const progress = useRef(new Animated.Value(0)).current;
  const content = STATUS_CONTENT[status] || STATUS_CONTENT.pendiente;

  useEffect(() => {
    progress.setValue(0);
    if (status !== 'preparando' && status !== 'en_camino' && status !== 'repartidor_asignado') return undefined;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: status === 'en_camino' || status === 'repartidor_asignado' ? 1600 : 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: status === 'en_camino' || status === 'repartidor_asignado' ? 1600 : 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, status]);

  const animatedStyle = status === 'en_camino' || status === 'repartidor_asignado'
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
      {status === 'repartidor_asignado' || status === 'en_camino' ? (
        <View style={styles.route}>
          <View style={styles.routeLabels}>
            <Text style={styles.routeEndpoint}>{status === 'repartidor_asignado' ? 'Repartidor' : 'Negocio'}</Text>
            <Text style={styles.routeEndpoint}>{status === 'repartidor_asignado' ? 'Negocio' : 'Casa'}</Text>
          </View>
          <View style={styles.routeTrack}>
            <View style={styles.routeLine} />
            <Animated.Text
              style={[
                styles.routeCourier,
                {
                  transform: [{
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 154],
                    }),
                  }],
                },
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
  route: { flexBasis: '100%', marginLeft: 46, marginTop: 6, marginRight: 8 },
  routeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  routeEndpoint: { color: '#687078', fontSize: 10, fontWeight: '700' },
  routeTrack: { height: 24, justifyContent: 'center' },
  routeLine: { height: 3, backgroundColor: '#D5C28A', borderRadius: 2 },
  routeCourier: { position: 'absolute', left: 0, top: -4, fontSize: 22 },
});
