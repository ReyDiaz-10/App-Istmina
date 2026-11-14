import { supabase } from '../api/supabaseClient';

const getImageFile = async (uri) => {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('No se pudo leer la imagen seleccionada.');
  const blob = await response.blob();
  const extension = blob.type?.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return { blob, contentType: blob.type || 'image/jpeg', extension };
};

const uploadImage = async (bucket, userId, label, uri) => {
  const { blob, contentType, extension } = await getImageFile(uri);
  const path = `${userId}/${label}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType, upsert: false });

  if (error) throw error;
  return path;
};

export async function uploadRegistrationMedia({
  userId,
  role,
  businessPhotoUri,
  driverPhotoUri,
  platePhotoUri,
}) {
  if (!userId) throw new Error('No se encontró el usuario para cargar sus imágenes.');
  let uploadedBusinessImageUrl = null;

  if (role === 'negocio' && businessPhotoUri) {
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id')
      .eq('profile_id', userId)
      .single();
    if (businessError) throw businessError;

    const path = await uploadImage('business-images', userId, 'store', businessPhotoUri);
    const { data: { publicUrl } } = supabase.storage.from('business-images').getPublicUrl(path);
    const { error } = await supabase
      .from('businesses')
      .update({ store_image_url: publicUrl })
      .eq('id', business.id)
      .select('id')
      .single();
    if (error) throw error;
    uploadedBusinessImageUrl = publicUrl;
  }

  if (role === 'repartidor') {
    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('id, verification_status')
      .eq('profile_id', userId)
      .single();
    if (driverError) throw driverError;
    if (driver.verification_status === 'aprobado'
      && (driverPhotoUri || platePhotoUri)) {
      throw new Error('Las fotos de un perfil aprobado solo pueden cambiarse con ayuda de SuperAdmin.');
    }

    if (driverPhotoUri) {
      const facePath = await uploadImage('profile-media', userId, 'avatar', driverPhotoUri);
      const [profileResult, verificationResult] = await Promise.all([
        supabase.from('profiles')
          .update({ avatar_url: facePath })
          .eq('id', userId)
          .select('id')
          .single(),
        supabase.from('driver_verifications')
          .update({ face_photo_attested: true })
          .eq('driver_id', driver.id)
          .select('driver_id')
          .single(),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (verificationResult.error) throw verificationResult.error;
    }

    if (platePhotoUri) {
      const platePath = await uploadImage('driver-documents', userId, 'plate', platePhotoUri);
      const { error } = await supabase.from('driver_verifications')
        .update({ plate_photo_path: platePath })
        .eq('driver_id', driver.id)
        .select('driver_id')
        .single();
      if (error) throw error;
    }
  }
  return uploadedBusinessImageUrl;
}

export async function uploadBusinessPhoto({ userId, uri }) {
  if (!userId || !uri) throw new Error('Selecciona una foto del local para continuar.');
  return uploadRegistrationMedia({ userId, role: 'negocio', businessPhotoUri: uri });
}

export async function getProfilePhotoUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const { data, error } = await supabase.storage
    .from('profile-media')
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadDriverPhoto({ userId, uri }) {
  if (!userId || !uri) throw new Error('Selecciona una foto para continuar.');
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, verification_status')
    .eq('profile_id', userId)
    .single();
  if (driverError) throw driverError;
  if (driver.verification_status === 'aprobado') {
    throw new Error('Las fotos de un perfil aprobado solo pueden cambiarse con ayuda de SuperAdmin.');
  }
  const path = await uploadImage('profile-media', userId, 'avatar', uri);

  const [profileResult, verificationResult] = await Promise.all([
    supabase.from('profiles')
      .update({ avatar_url: path })
      .eq('id', userId)
      .select('id')
      .single(),
    supabase.from('driver_verifications')
      .update({ face_photo_attested: true })
      .eq('driver_id', driver.id)
      .select('driver_id')
      .single(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (verificationResult.error) throw verificationResult.error;
  return path;
}

export async function uploadDriverPlatePhoto({ userId, uri }) {
  if (!userId || !uri) throw new Error('Selecciona una foto de la placa para continuar.');
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, verification_status')
    .eq('profile_id', userId)
    .single();
  if (driverError) throw driverError;
  if (driver.verification_status === 'aprobado') {
    throw new Error('Los documentos de un perfil aprobado solo pueden cambiarse con ayuda de SuperAdmin.');
  }
  const path = await uploadImage('driver-documents', userId, 'plate', uri);

  const { error } = await supabase.from('driver_verifications')
    .update({ plate_photo_path: path })
    .eq('driver_id', driver.id)
    .select('driver_id')
    .single();
  if (error) throw error;
  return path;
}

export async function uploadDriverIdentityPhoto({ userId, uri }) {
  if (!userId || !uri) throw new Error('Selecciona una foto del documento para continuar.');
  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, verification_status')
    .eq('profile_id', userId)
    .single();
  if (driverError) throw driverError;
  if (driver.verification_status === 'aprobado') {
    throw new Error('Los documentos de un perfil aprobado solo pueden cambiarse con ayuda de SuperAdmin.');
  }
  const path = await uploadImage('driver-documents', userId, 'identity', uri);

  const { error } = await supabase.from('driver_verifications')
    .update({ identity_document_path: path })
    .eq('driver_id', driver.id)
    .select('driver_id')
    .single();
  if (error) throw error;
  return path;
}

export async function getDriverDocumentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('driver-documents')
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
