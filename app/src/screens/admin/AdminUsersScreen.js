import { AppText as Text, AppTextInput as TextInput } from '../../components/AppText.js';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../api/supabaseClient';
import { useAppTheme } from '../../hooks/useAppTheme';

const ROLES = [
  ['cliente', 'Clientes'],
  ['negocio', 'Negocios'],
  ['repartidor', 'Repartidores'],
];

const statusLabel = (user) => {
  if (user.account_deactivated_at) return 'Baja definitiva';
  if (user.status === 'bloqueado') return 'Bloqueado';
  return user.status || 'Sin estado';
};

export default function AdminUsersScreen({ navigation }) {
  const { colors } = useAppTheme();
  const [roles, setRoles] = useState(ROLES.map(([role]) => role));
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    if (!roles.length) {
      setUsers([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('profiles')
        .select('id,full_name,nickname,phone,role,status,created_at,account_blocked_until,account_status_reason,account_deactivated_at')
        .in('role', roles)
        .order('created_at', { ascending: false })
        .limit(500);
      const term = search.trim().replace(/[^A-Za-zÀ-ÿ0-9+@\- ]/g, '').trim();
      if (term) {
        const pattern = `*${term}*`;
        query = query.or(`full_name.ilike.${pattern},nickname.ilike.${pattern},phone.ilike.${pattern}`);
      }
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setUsers(data || []);
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el directorio de perfiles.');
    } finally {
      setLoading(false);
    }
  }, [roles, search]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadUsers(); }, 250);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const toggleRole = (role) => {
    setRoles((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : [...current, role]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={[styles.back, { borderColor: colors.border }]}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>‹ Panel Admin</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void loadUsers()} style={[styles.refresh, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.onPrimary, fontWeight: '800' }}>Actualizar</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Usuarios y perfiles</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>Busca clientes, negocios y repartidores. Abre un perfil para consultar su actividad y administrar su acceso.</Text>

        <TextInput
          accessibilityLabel="Buscar por nombre o teléfono"
          value={search}
          onChangeText={setSearch}
          placeholder="Nombre o teléfono"
          placeholderTextColor={colors.muted}
          style={[styles.search, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        />
        <Text style={[styles.label, { color: colors.text }]}>Filtrar por rol</Text>
        <View style={styles.filters}>
          {ROLES.map(([role, label]) => {
            const checked = roles.includes(role);
            return (
              <Pressable
                key={role}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => toggleRole(role)}
                style={[styles.filter, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.elevated : colors.surface }]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>{checked ? '☑' : '☐'} {label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.results, { color: colors.muted }]}>{users.length} perfiles cargados</Text>
        {loading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !error && users.length === 0 ? <Text style={[styles.empty, { color: colors.muted }]}>No hay perfiles para esos filtros.</Text> : null}
        {users.map((user) => (
          <Pressable
            key={user.id}
            accessibilityRole="button"
            onPress={() => navigation.navigate('AdminUserDetails', { profileId: user.id })}
            style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.userMain}>
              <Text style={[styles.userName, { color: colors.text }]}>{user.full_name || user.nickname || 'Perfil sin nombre'}</Text>
              <Text style={[styles.copy, { color: colors.muted }]}>{user.phone || 'Sin teléfono'} · {user.role}</Text>
              <Text style={[styles.state, { color: user.status === 'bloqueado' || user.account_deactivated_at ? '#B42318' : colors.primary }]}>{statusLabel(user)}</Text>
            </View>
            <Text style={[styles.detailLink, { color: colors.primary }]}>Ver detalle ›</Text>
          </Pressable>
        ))}
        {!loading && users.length >= 500 ? <Text style={[styles.copy, { color: colors.muted }]}>Se muestran hasta 500 resultados; usa los filtros para acotar la búsqueda.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 36, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderRadius: 9 },
  refresh: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 9 },
  title: { fontSize: 25, fontWeight: '900', marginTop: 8 },
  copy: { fontSize: 14, lineHeight: 20 },
  search: { borderWidth: 1, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, marginTop: 8 },
  label: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderWidth: 1, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 11 },
  results: { fontSize: 12, marginTop: 5 },
  spinner: { marginTop: 22 },
  error: { color: '#B42318', backgroundColor: '#FEE4E2', padding: 12, borderRadius: 9 },
  empty: { paddingVertical: 20 },
  userCard: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  userMain: { flex: 1, gap: 4 },
  userName: { fontSize: 16, fontWeight: '800' },
  state: { fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  detailLink: { fontWeight: '800' },
});
