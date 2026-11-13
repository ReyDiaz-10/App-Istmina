// app/src/screens/client/SupportTickets.js
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import AnimatedButton from '../../components/AnimatedButton';

const SupportTickets = ({ route, navigation }) => {
  const { profile } = useAuthStore();
  const { colors } = useAppTheme();
  const [form, setForm] = useState({ subject: '', message: '', type: route?.params?.context ? 'soporte' : 'sugerencia' });
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const context = route?.params?.context;

  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('support_tickets').select('id, subject, category, status, admin_reply, created_at')
      .eq('requester_id', profile.id).order('created_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        if (!error) setTickets(data || []);
        setLoadingTickets(false);
      });
  }, [profile?.id]);

  const sendTicket = async () => {
    if (!profile?.id) {
      Alert.alert('Inicia sesión', 'Para que podamos dar seguimiento a tu solicitud, inicia sesión o crea una cuenta.', [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Iniciar sesión', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }
    if (!form.subject || !form.message) {
      Alert.alert('Atención', 'Por favor completa el asunto y el mensaje');
      return;
    }

    setLoading(true);
    try {
      const { data: ticket, error } = await supabase.from('support_tickets').insert({
          requester_id: profile.id,
          subject: form.subject,
          message: form.message,
          category: form.type,
          status: 'pendiente',
          order_id: route?.params?.orderId || null,
          context: context || null,
        }).select('id').single();

      if (error) throw error;
      let confirmationTitle = 'Enviado';
      let confirmationMessage = 'Tu mensaje ha sido recibido. Te responderemos pronto.';
      if (form.type === 'queja') {
        const { error: notificationError } = await supabase.functions.invoke('notify-business-complaint', {
          body: { ticketId: ticket.id },
        });
        if (notificationError) {
          confirmationTitle = 'Queja recibida';
          confirmationMessage = `El caso quedó registrado, pero no se pudo enviar el correo de notificación: ${notificationError.message}`;
        }
      }
      Alert.alert(confirmationTitle, confirmationMessage);
      setForm({ subject: '', message: '', type: context ? 'soporte' : 'sugerencia' });
      const { data: currentTickets } = await supabase.from('support_tickets').select('id, subject, category, status, admin_reply, created_at').eq('requester_id', profile.id).order('created_at', { ascending: false }).limit(20);
      setTickets(currentTickets || []);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <AnimatedButton variant="back" navigation={navigation} style={styles.backButton} />
        <Text style={[styles.title, { color: colors.text }]}>Soporte IstmiYa</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>{context ? `Ayuda para ${context}. Cuéntanos qué ocurrió y nuestro equipo podrá intervenir.` : 'Cuéntanos cómo podemos mejorar tu experiencia'}</Text>
      </View>

      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Asunto</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
          placeholder="Ej: Problema con mi pedido" 
          value={form.subject}
          onChangeText={(t) => setForm({...form, subject: t})}
        />

        <Text style={[styles.label, { color: colors.text }]}>Mensaje</Text>
        <TextInput 
          style={[styles.input, styles.textArea, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]} 
          placeholder="Describe tu situación detalladamente..." 
          multiline
          numberOfLines={6}
          value={form.message}
          onChangeText={(t) => setForm({...form, message: t})}
        />

        <Text style={[styles.label, { color: colors.text }]}>Tipo de Reporte</Text>
        <View style={styles.typeContainer}>
          {['sugerencia', 'queja', 'felicitación', 'soporte'].map(type => (
            <TouchableOpacity 
              key={type} 
              style={[styles.typeBtn, form.type === type && styles.typeBtnActive]} 
              onPress={() => setForm({...form, type})}
            >
              <Text style={[styles.typeText, form.type === type && styles.typeTextActive]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <AnimatedButton
          title={loading ? 'Enviando...' : 'Enviar reporte'}
          onPress={sendTicket}
          disabled={loading}
          style={{ alignSelf: 'stretch', marginTop: 30 }}
        />
      </View>
      {profile?.id && <View style={styles.requests}>
        <Text style={[styles.label, { color: colors.text }]}>Mis solicitudes</Text>
        {loadingTickets ? <ActivityIndicator color={colors.primary} /> : tickets.length === 0 ? <Text style={[styles.subtitle, { color: colors.muted }]}>Aún no tienes solicitudes.</Text> : tickets.map((ticket) => <View key={ticket.id} style={[styles.ticket, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.ticketTitle, { color: colors.text }]}>{ticket.subject}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{ticket.category} · {ticket.status}</Text>
          {ticket.admin_reply ? <Text style={[styles.reply, { color: colors.primary }]}>Respuesta de IstmiYa: {ticket.admin_reply}</Text> : <Text style={[styles.subtitle, { color: colors.muted }]}>El equipo aún no ha respondido.</Text>}
        </View>)}
      </View>}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 30, alignItems: 'center', marginBottom: 20 },
  backButton: { alignSelf: 'flex-start', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 'bold' },
  subtitle: { fontSize: 14, textAlign: 'center', marginTop: 5 },
  form: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  input: { padding: 15, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  textArea: { height: 120, textAlignVertical: 'top' },
  typeContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  typeBtn: { flex: 1, padding: 10, marginHorizontal: 5, borderRadius: 8, borderWidth: 1, borderColor: '#1A237E', alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1A237E' },
  typeText: { color: '#1A237E', fontWeight: '600' },
  typeTextActive: { color: '#fff' },
  requests: { paddingHorizontal: 20, paddingBottom: 28 },
  ticket: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 },
  ticketTitle: { fontWeight: '700' },
  reply: { marginTop: 8, lineHeight: 20 },
});

export default SupportTickets;
