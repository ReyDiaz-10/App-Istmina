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
        .maybeSingle();

      if (error) throw error;
      
      if (!data) {
        console.log("No se encontró perfil, el usuario debe completar su registro.");
        set({ profile: null, loading: false });
      } else {
        set({ profile: data, loading: false });
      }
    } catch (error) {
      console.error('Error crítico cargando perfil:', error.message);
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

  signUp: async ({
    email,
    password,
    fullName,
    phone,
    role,
    storeName,
    legalName,
    registrationIdType,
    registrationId,
    address,
    complaintEmail,
    slogan,
    vehicleType,
    plateNumber,
  }) => {
    set({ loading: true });
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            role,
            ...(role === 'negocio' && {
              store_name: storeName.trim(),
              legal_name: legalName.trim(),
              registration_id_type: registrationIdType,
              registration_id: registrationId.trim(),
              address: address.trim(),
              complaint_email: complaintEmail.trim().toLowerCase(),
              slogan: slogan.trim(),
            }),
            ...(role === 'repartidor' && {
              vehicle_type: vehicleType.trim(),
              plate_number: plateNumber.trim().toUpperCase(),
              face_photo_attested: 'true',
            }),
          },
        },
      });

      if (authError) throw authError;
      if (!data.user?.id) throw new Error('Supabase no devolvió el usuario creado.');

      const requiresEmailConfirmation = !data.session;
      if (!requiresEmailConfirmation) {
        set({ user: data.user });
        await useAuthStore.getState().fetchProfile(data.user.id);
        if (!useAuthStore.getState().profile) {
          throw new Error('La cuenta se creó, pero no se pudo cargar el perfil. Intenta iniciar sesión.');
        }
      }
      
      set({ loading: false });
      return { success: true, userId: data.user.id, requiresEmailConfirmation };
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