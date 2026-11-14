import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../api/supabaseClient';
import AnimatedButton from '../../components/AnimatedButton';
import { useAppTheme } from '../../hooks/useAppTheme';

const ROLES = ['Todos', 'cliente', 'negocio', 'repartidor', 'admin', 'superadmin'];

export default function AdminActivityScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('Todos');
  const [action, setAction] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('system_audit_logs')
      .select('id, actor_id, actor_name, actor_role, action, entity_type, entity_id, metadata, created_at')
      .order('created_at', { ascending: false }).limit(500);
    if (error) console.error('No se pudo cargar la auditoría:', error.message);
    else setEntries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('admin-audit-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_audit_logs' }, ({ new: entry }) => {
        setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 500));
      }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const filtered = useMemo(() => entries.filter((entry) => {
    const needle = query.trim().toLocaleLowerCase();
    const matchesText = !needle || `${entry.actor_name} ${entry.action} ${entry.entity_type || ''} ${entry.entity_id || ''}`.toLocaleLowerCase().includes(needle);
    return matchesText && (role === 'Todos' || entry.actor_role === role)
      && (!action.trim() || entry.action.toLocaleLowerCase().includes(action.trim().toLocaleLowerCase()));
  }), [entries, query, role, action]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}><AnimatedButton variant="back" navigation={navigation} /><Text style={[styles.title, { color: colors.text }]}>Auditoría de actividad</Text></View>
      <Text style={[styles.help, { color: colors.muted }]}>Historial en vivo. El nombre mostrado es el nombre de registro, no el apodo.</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="Filtrar por nombre, usuario o registro" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} />
      <Text style={[styles.label, { color: colors.text }]}>Rol</Text>
      <View style={styles.roleRow}>{ROLES.map((item) => <Text key={item} onPress={() => setRole(item)} style={[styles.role, { color: role === item ? colors.surface : colors.text, backgroundColor: role === item ? colors.primary : colors.surface }]}>{item}</Text>)}</View>
      <TextInput value={action} onChangeText={setAction} placeholder="Filtrar por acción" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]} />
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {!loading && filtered.length === 0 ? <Text style={[styles.help, { color: colors.muted }]}>No hay actividad que coincida con los filtros.</Text> : null}
      {filtered.map((entry) => <View key={entry.id} style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.name, { color: colors.text }]}>{entry.actor_name} <Text style={[styles.roleInline, { color: colors.primary }]}>· {entry.actor_role}</Text></Text>
        <Text style={[styles.action, { color: colors.text }]}>{entry.action}</Text>
        <Text style={[styles.help, { color: colors.muted }]}>{new Date(entry.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Bogota' })}{entry.entity_type ? ` · ${entry.entity_type}` : ''}{entry.entity_id ? ` · ${entry.entity_id}` : ''}</Text>
      </View>)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, container: { flexGrow: 1, padding: 18, paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { fontSize: 23, fontWeight: '800', flex: 1 }, help: { fontSize: 13, lineHeight: 19, marginVertical: 7 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 6 }, label: { fontWeight: '700', marginTop: 8 }, roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 8 },
  role: { overflow: 'hidden', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 16, fontSize: 12 }, card: { borderRadius: 11, padding: 13, marginTop: 8 },
  name: { fontSize: 15, fontWeight: '700' }, roleInline: { fontSize: 12 }, action: { marginTop: 5 },
});
