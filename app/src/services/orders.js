import { supabase } from '../api/supabaseClient';

export async function createOrder({ businessId, items }) {
  const { data, error } = await supabase.rpc('create_order', {
    p_business_id: businessId,
    p_items: items.map(({ id, quantity }) => ({
      product_id: id,
      quantity,
    })),
    p_payment_method: 'wompi',
  });

  if (error) throw error;
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
