import { create } from 'zustand';
import { supabase } from '../api/supabaseClient';

export const useAuthStore = create((set, get) => ({
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
        return null;
      } else {
        set({ profile: data, loading: false });
        return data;
      }
    } catch (error) {
      console.error('Error crítico cargando perfil:', error.message);
      set({ loading: false });
      throw error;
    }
  },

  updateProfileDetails: async ({ fullName, nickname, phone }) => {
    set({ loading: true });
    try {
      const userId = get().user?.id;
      if (!userId) throw new Error('Debes iniciar sesión para editar tu perfil.');
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          nickname: nickname.trim(),
          phone: phone.trim(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      set({ profile: data, loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },

  requestEmailChange: async (email) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.updateUser({
        email: email.trim().toLowerCase(),
      });
      if (error) throw error;
      if (!data.user) throw new Error('Supabase no devolvió el usuario actualizado.');
      const confirmationRequired = data.user.email?.toLowerCase() !== email.trim().toLowerCase();
      set({ user: confirmationRequired ? get().user : data.user, loading: false });
      return {
        success: true,
        confirmationRequired,
      };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },

  updatePassword: async (password) => {
    set({ loading: true });
    try {
      if (!get().user) throw new Error('Debes iniciar sesión para cambiar la contraseña.');
      if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      set({ loading: false });
      return { success: true };
    } catch (error) {
      set({ loading: false });
      return { success: false, error: error.message };
    }
  },

  signIn: async (email, password) => {
    set({ loading: true, profile: null });
    let authenticationSucceeded = false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      authenticationSucceeded = true;
      await set({ user: data.user });
      const profile = await useAuthStore.getState().fetchProfile(data.user.id);
      if (!profile) {
        throw new Error('La cuenta inició sesión, pero no tiene un perfil en la tabla profiles. Aplica las migraciones 0018 y 0019 para habilitar el perfil admin.');
      }
      if (!['cliente', 'negocio', 'repartidor', 'admin', 'superadmin'].includes(profile.role)) {
        throw new Error(`El perfil tiene un rol no reconocido (${profile.role || 'vacío'}). La cuenta administrativa debe quedar como admin.`);
      }
      try {
        const { error: auditError } = await supabase.rpc('record_user_sign_in');
        if (auditError) console.warn('No se pudo registrar el inicio de sesión:', auditError.message);
      } catch (auditError) {
        console.warn('No se pudo registrar el inicio de sesión:', auditError.message);
      }
      
      set({ loading: false });
      return { success: true };
    } catch (error) {
      if (authenticationSucceeded) {
        try { await supabase.auth.signOut(); } catch (signOutError) {
          console.warn('No se pudo cerrar la sesión incompleta:', signOutError.message);
        }
        set({ user: null, profile: null });
      }
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
      try {
        const { error: auditError } = await supabase.rpc('record_user_sign_out');
        if (auditError) console.warn('No se pudo registrar el cierre de sesión:', auditError.message);
      } catch (auditError) {
        console.warn('No se pudo registrar el cierre de sesión:', auditError.message);
      }
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
