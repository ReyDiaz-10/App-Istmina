import { create } from 'zustand';
import { supabase } from '../api/supabaseClient';

export const useAuthStore = create((set) => ({
  user: null,          
  profile: null,      
  loading: false,

  fetchProfile: async (userId) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      set({ profile: data, loading: false });
    } catch (error) {
      console.error('Error cargando perfil:', error.message);
      set({ loading: false });
    }
  },

  signIn: async (email, password) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      await set({ user: data.user });
      await useAuthStore.getState().fetchProfile(data.user.id);
      
      set({ loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },

  signUp: async ({ email, password, fullName, phone, role }) => {
    set({ loading: true });
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;

      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          {
            id: data.user.id,
            full_name: fullName,
            phone: phone,
            role: role, 
          },
        ]);

      if (profileError) throw profileError;

      set({ user: data.user });
      await useAuthStore.getState().fetchProfile(data.user.id);
      
      set({ loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },

  signOut: async () => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      set({ user: null, profile: null, loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },
}));