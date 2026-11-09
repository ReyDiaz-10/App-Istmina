// app/src/screens/client/SupportTickets.js
import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { useAuthStore } from '../../store/authStore';
import PremiumButton from '../../components/PremiumButton';

const SupportTickets = () => {
  const { profile } = useAuthStore();
  const [form, setForm] = useState({ subject: '', message: '', type: 'sugerencia' });
  const [loading, setLoading] = useState(false);

  const sendTicket = async () => {
    if (!form.subject || !form.message) {
      Alert.alert('Atención', 'Por favor completa el asunto y el mensaje');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('support_tickets').insert([
        {
          client_id: profile.id,
          subject: form.subject,
          message: form.message,
          category: form.type,
          status: 'pendiente',
        },
      ]);

      if (error) throw error;
      Alert.alert('Enviado', 'Tu mensaje ha sido recibido. Te responderemos pronto.');
      setForm({ subject: '', message: '', type: 'sugerencia' });
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Soporte IstmiYa</Text>
        <Text style={styles.subtitle}>Cuéntanos cómo podemos mejorar tu experiencia</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Asunto</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Ej: Problema con mi pedido" 
          value={form.subject}
          onChangeText={(t) => setForm({...form, subject: t})}
        />

        <Text style={styles.label}>Mensaje</Text>
        <TextInput 
          style={[styles.input, styles.textArea]} 
          placeholder="Describe tu situación detalladamente..." 
          multiline
          numberOfLines={6}
          value={form.message}
          onChangeText={(t) => setForm({...form, message: t})}
        />

        <Text style={styles.label}>Tipo de Reporte</Text>
        <View style={styles.typeContainer}>
          {['sugerencia', 'queja', 'felicitación'].map(type => (
            <TouchableOpacity 
              key={type} 
              style={[styles.typeBtn, form.type === type && styles.typeBtnActive]} 
              onPress={() => setForm({...form, type})}
            >
              <Text style={[styles.typeText, form.type === type && styles.typeTextActive]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <PremiumButton 
          title={loading ? "Enviando..." : "Enviar Reporte"} 
          onPress={sendTicket} 
          style={{ marginTop: 30 }}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { padding: 30, alignItems: 'center', backgroundColor: '#fff', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1A237E' },
  subtitle: { fontSize: 14, color: '#757575', textAlign: 'center', marginTop: 5 },
  form: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  input: { backgroundColor: '#fff', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 20 },
  textArea: { height: 120, textAlignVertical: 'top' },
  typeContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  typeBtn: { flex: 1, padding: 10, marginHorizontal: 5, borderRadius: 8, borderWidth: 1, borderColor: '#1A237E', alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1A237E' },
  typeText: { color: '#1A237E', fontWeight: '600' },
  typeTextActive: { color: '#fff' },
});

export default SupportTickets;
