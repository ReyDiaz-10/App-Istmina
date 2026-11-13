import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { APP_INFO } from '../../constants/appInfo';
import { useAppTheme } from '../../hooks/useAppTheme';
import AnimatedButton from '../../components/AnimatedButton';

const Section = ({ title, children, colors }) => <>
  <Text style={[styles.heading, { color: colors.text }]}>{title}</Text>
  <Text style={[styles.body, { color: colors.text }]}>{children}</Text>
</>;

export default function PrivacyScreen({ navigation }) {
  const { colors } = useAppTheme();
  const openPolicy = async () => {
    try {
      await Linking.openURL(APP_INFO.privacyPolicyUrl);
    } catch (error) {
      Alert.alert('No se pudo abrir la política', error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <AnimatedButton variant="back" navigation={navigation} style={styles.backButton} />
      <Text style={[styles.title, { color: colors.text }]}>Política de tratamiento de datos personales</Text>
      <Text style={styles.draft}>BORRADOR PARA REVISIÓN: completar los datos entre corchetes y validar jurídicamente antes de publicar.</Text>
      <Section colors={colors} title="Responsable">[NOMBRE O RAZÓN SOCIAL DEL RESPONSABLE], con domicilio en [DIRECCIÓN, MUNICIPIO], Colombia. Contacto para consultas y reclamos: {APP_INFO.privacyEmail || '[CORREO DE PRIVACIDAD POR CONFIGURAR]'}.</Section>
      <Section colors={colors} title="Datos y finalidades">IstmiYa puede tratar datos de identificación y contacto, información de cuenta y perfil, pedidos, pagos y soporte para crear y administrar cuentas, conectar clientes con negocios y repartidores, procesar pedidos y pagos, prestar soporte, prevenir fraude y cumplir obligaciones legales. La ubicación solo debe tratarse para las funciones de entrega que el usuario active.</Section>
      <Section colors={colors} title="Compartición y conservación">Los datos necesarios se comparten con las partes de un pedido y con proveedores tecnológicos y de pago que prestan servicios a IstmiYa, bajo las finalidades informadas. Se conservan durante el tiempo necesario para esas finalidades y las obligaciones legales y contables aplicables; los plazos concretos deben definirse en el procedimiento interno de retención.</Section>
      <Section colors={colors} title="Derechos del titular">Puedes conocer, actualizar y rectificar tus datos; solicitar prueba de la autorización; conocer su uso; presentar consultas o reclamos; y solicitar revocatoria o supresión cuando legalmente proceda. Envía la solicitud a {APP_INFO.privacyEmail || '[CORREO DE PRIVACIDAD POR CONFIGURAR]'} e identifica la cuenta y el derecho que deseas ejercer. Se aplicarán los términos legales vigentes.</Section>
      <Section colors={colors} title="Autorización y cambios">Antes de recopilar datos, IstmiYa debe informar la finalidad y obtener y conservar la autorización cuando sea exigible. La versión y fecha de vigencia de esta política deben publicarse aquí. Esta pantalla es un borrador informativo y no sustituye la validación legal ni el aviso de privacidad del registro.</Section>
      {!!APP_INFO.privacyPolicyUrl && (
        <AnimatedButton
          title="Abrir política general de tratamiento de datos"
          onPress={openPolicy}
          variant="secondary"
          style={styles.policyButton}
          textStyle={styles.link}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 22 }, backButton: { alignSelf: 'flex-start', marginBottom: 8 }, title: { fontSize: 25, fontWeight: '800', marginBottom: 12 }, draft: { color: '#9A4D00', backgroundColor: '#FFF4E5', padding: 12, borderRadius: 9, lineHeight: 20 }, heading: { fontSize: 17, fontWeight: '700', marginTop: 20, marginBottom: 5 }, body: { fontSize: 15, lineHeight: 23 }, policyButton: { alignSelf: 'stretch', marginTop: 20 }, link: { color: '#1A237E' } });
