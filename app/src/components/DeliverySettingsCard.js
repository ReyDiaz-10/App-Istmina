import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import AnimatedButton from './AnimatedButton';
import { supabase } from '../api/supabaseClient';
import { useAppTheme } from '../hooks/useAppTheme';

const DeliverySettingsCard = ({ business, onSaved }) => {
  const { colors } = useAppTheme();
  const [mode, setMode] = useState(business.delivery_fee_mode || 'merchant_fixed');
  const [fee, setFee] = useState(String(business.delivery_fee_cop ?? 4500));
  const [latitude, setLatitude] = useState(
    business.latitude == null ? '' : String(business.latitude),
  );
  const [longitude, setLongitude] = useState(
    business.longitude == null ? '' : String(business.longitude),
  );
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    setMode(business.delivery_fee_mode || 'merchant_fixed');
    setFee(String(business.delivery_fee_cop ?? 4500));
    setLatitude(business.latitude == null ? '' : String(business.latitude));
    setLongitude(business.longitude == null ? '' : String(business.longitude));
  }, [business]);

  const useCurrentLocation = async () => {
    setLocating(true);
    setFeedback(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Se necesita permiso de ubicación para guardar el punto del local.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLatitude(position.coords.latitude.toFixed(6));
      setLongitude(position.coords.longitude.toFixed(6));
      setFeedback('Ubicación capturada. Guarda los cambios para aplicarla.');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setLocating(false);
    }
  };

  const saveSettings = async () => {
    const feeCop = Number(fee);
    if (!Number.isInteger(feeCop) || feeCop < 4500 || feeCop > 7500) {
      Alert.alert('Tarifa inválida', 'La tarifa debe estar entre $4.500 y $7.500 COP.');
      return;
    }

    let parsedLatitude = null;
    let parsedLongitude = null;
    const hasLatitude = Boolean(latitude.trim());
    const hasLongitude = Boolean(longitude.trim());
    if (hasLatitude !== hasLongitude) {
      Alert.alert('Ubicación incompleta', 'Ingresa tanto la latitud como la longitud.');
      return;
    }
    if (hasLatitude && hasLongitude) {
      parsedLatitude = Number(latitude);
      parsedLongitude = Number(longitude);
      if (
        !Number.isFinite(parsedLatitude)
        || !Number.isFinite(parsedLongitude)
        || parsedLatitude < -90
        || parsedLatitude > 90
        || parsedLongitude < -180
        || parsedLongitude > 180
      ) {
        Alert.alert('Ubicación inválida', 'Verifica la latitud y longitud del local.');
        return;
      }
    }

    if (mode === 'istmiya_dynamic' && (parsedLatitude == null || parsedLongitude == null)) {
      Alert.alert('Falta la ubicación', 'Guarda primero las coordenadas del local para usar la tarifa dinámica.');
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase
        .from('businesses')
        .update({
          delivery_fee_mode: mode,
          delivery_fee_cop: feeCop,
          latitude: parsedLatitude,
          longitude: parsedLongitude,
        })
        .eq('id', business.id)
        .select('*')
        .single();

      if (error) throw error;
      onSaved?.(data);
      setFeedback('Configuración de domicilio guardada.');
    } catch (error) {
      setFeedback(`No se pudo guardar: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Tarifa de domicilio</Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Elige una tarifa fija o el cálculo por distancia de IstmiYa.
      </Text>
      <View style={styles.modeRow}>
        <AnimatedButton
          title="Fija del local"
          onPress={() => setMode('merchant_fixed')}
          variant={mode === 'merchant_fixed' ? 'primary' : 'secondary'}
          style={styles.modeButton}
        />
        <AnimatedButton
          title="Dinámica IstmiYa"
          onPress={() => setMode('istmiya_dynamic')}
          variant={mode === 'istmiya_dynamic' ? 'primary' : 'secondary'}
          style={styles.modeButton}
        />
      </View>

      <TextInput
        accessibilityLabel="Tarifa fija de domicilio en pesos"
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
        value={fee}
        onChangeText={setFee}
        keyboardType="number-pad"
        placeholder="Tarifa fija en COP (4500–7500)"
        placeholderTextColor={colors.muted}
        editable={mode === 'merchant_fixed'}
      />

      <Text style={[styles.hint, { color: colors.muted }]}>
        {mode === 'istmiya_dynamic'
          ? 'Dinámica: $4.500 por los primeros 2 km, luego $700 por km adicional, máximo $7.500.'
          : 'La tarifa fija debe estar entre $4.500 y $7.500 COP.'}
      </Text>

      {mode === 'istmiya_dynamic' ? (
        <>
          <View style={styles.coordinates}>
            <TextInput
              accessibilityLabel="Latitud del negocio"
              style={[styles.input, styles.coordinateInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="decimal-pad"
              placeholder="Latitud"
              placeholderTextColor={colors.muted}
            />
            <TextInput
              accessibilityLabel="Longitud del negocio"
              style={[styles.input, styles.coordinateInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.input }]}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="decimal-pad"
              placeholder="Longitud"
              placeholderTextColor={colors.muted}
            />
          </View>
          <AnimatedButton
            title={locating ? 'Obteniendo ubicación...' : 'Usar ubicación actual del local'}
            onPress={useCurrentLocation}
            disabled={locating}
            variant="secondary"
            style={styles.action}
          />
        </>
      ) : null}

      <AnimatedButton
        title={saving ? 'Guardando...' : 'Guardar tarifa'}
        onPress={saveSettings}
        disabled={saving || locating}
        style={styles.action}
      />
      {feedback ? (
        <Text accessibilityRole="alert" style={[styles.feedback, { color: colors.muted }]}>
          {feedback}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 16, marginBottom: 20, borderWidth: 1 },
  title: { fontSize: 17, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeButton: { flex: 1, alignSelf: 'stretch' },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 12 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  coordinates: { flexDirection: 'row', gap: 8 },
  coordinateInput: { flex: 1, minWidth: 0 },
  action: { alignSelf: 'stretch', marginTop: 10 },
  feedback: { fontSize: 13, marginTop: 9 },
});

export default DeliverySettingsCard;
