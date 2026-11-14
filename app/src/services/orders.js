import { supabase } from '../api/supabaseClient';

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
  deliveryLatitude = null,
  deliveryLongitude = null,
}) {
  const { data, error } = await supabase.rpc('create_order_with_delivery', {
    p_business_id: businessId,
    p_items: items.map(({ id, quantity }) => ({
      product_id: id,
      quantity,
    })),
    p_payment_method: 'wompi',
    p_delivery_latitude: deliveryLatitude,
    p_delivery_longitude: deliveryLongitude,
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
