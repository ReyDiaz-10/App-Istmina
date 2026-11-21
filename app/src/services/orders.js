import { supabase } from '../api/supabaseClient';

export function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export async function quoteDeliveryFee({
  businessId,
  deliveryLatitude = null,
  deliveryLongitude = null,
}) {
  const { data, error } = await supabase.rpc('quote_delivery_fee', {
    p_business_id: businessId,
    p_delivery_latitude: deliveryLatitude,
    p_delivery_longitude: deliveryLongitude,
  });

  if (error) throw error;
  const quote = Array.isArray(data) ? data[0] : data;
  if (!quote || !Number.isInteger(Number(quote.delivery_fee_cop))) {
    throw new Error('Supabase did not return a valid delivery quote.');
  }
  return quote;
}

export async function createOrder({
  businessId,
  items,
  deliveryLatitude,
  deliveryLongitude,
  deliveryAddress,
  deliveryInstructions = null,
}) {
  const { data, error } = await supabase.rpc('create_order_with_delivery_v2', {
    p_business_id: businessId,
    p_items: items.map(({ id, quantity, optionIds = [] }) => ({
      product_id: id,
      quantity,
      option_ids: optionIds,
    })),
    p_delivery_latitude: deliveryLatitude,
    p_delivery_longitude: deliveryLongitude,
    p_delivery_address: deliveryAddress,
    p_delivery_instructions: deliveryInstructions || null,
  });

  if (error) {
    if (error.message?.includes('WALLET_INSUFFICIENT')) {
      const { error: auditError } = await supabase.rpc('record_blocked_business_order_attempt', {
        p_business_id: businessId,
      });
      if (auditError) console.warn('No se pudo registrar el intento bloqueado por saldo:', auditError.message);
    }
    throw error;
  }
  if (typeof data !== 'string') {
    throw new Error('Supabase did not return the new order ID.');
  }
  return data;
}

export async function createPickupOrder({ businessId, items, idempotencyKey }) {
  const { data, error } = await supabase.rpc('create_pickup_order', {
    p_business_id: businessId,
    p_items: items.map(({ id, quantity, optionIds = [] }) => ({
      product_id: id,
      quantity,
      option_ids: optionIds,
    })),
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Supabase did not return the pickup order ID.');
  return data;
}

export async function createBusinessPaymentLink(purpose) {
  const { data, error } = await supabase.functions.invoke('create-wompi-payment', {
    body: { purpose },
  });

  if (error) throw error;
  if (!data?.payment_url) {
    throw new Error('The payment service did not return a Wompi link.');
  }
  return data.payment_url;
}

export async function createOrderPaymentLink(orderId) {
  const { data, error } = await supabase.functions.invoke('create-wompi-payment', {
    body: { orderId },
  });

  if (error) throw error;
  if (!data?.payment_url) {
    throw new Error('The payment service did not return a Wompi link.');
  }
  return data.payment_url;
}
