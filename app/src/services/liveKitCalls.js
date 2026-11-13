import { supabase } from '../api/supabaseClient';

export async function startOrderCall(orderId) {
  const { data, error } = await supabase.rpc('start_order_call', { p_order_id: orderId });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Supabase no devolvió el identificador de llamada.');
  return data;
}

export async function respondToOrderCall(callId, accept) {
  const { error } = await supabase.rpc('respond_order_call', {
    p_call_id: callId,
    p_accept: accept,
  });
  if (error) throw error;
}

export async function endOrderCall(callId) {
  const { error } = await supabase.rpc('end_order_call', { p_call_id: callId });
  if (error) throw error;
}

export async function expireOrderCall(callId) {
  const { error } = await supabase.rpc('expire_order_call', { p_call_id: callId });
  if (error) throw error;
}

export async function createOrderCallToken(callId) {
  const { data, error } = await supabase.functions.invoke('create-livekit-token', {
    body: { callId },
  });
  if (error) throw error;
  if (!data?.token || !data?.serverUrl) {
    throw new Error(data?.error || 'LiveKit no devolvió las credenciales de la llamada.');
  }
  return data;
}
