import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const enabled = process.env.ISTMIYA_RUN_FINANCIAL_INTEGRATION === 'true';
const requiredEnvironment = [
  'ISTMIYA_TEST_SUPABASE_URL',
  'ISTMIYA_TEST_SUPABASE_ANON_KEY',
  'ISTMIYA_TEST_SUPABASE_SERVICE_ROLE_KEY',
  'ISTMIYA_TEST_CLIENT_EMAIL',
  'ISTMIYA_TEST_CLIENT_PASSWORD',
  'ISTMIYA_TEST_BUSINESS_EMAIL',
  'ISTMIYA_TEST_BUSINESS_PASSWORD',
  'ISTMIYA_TEST_DRIVER_ONE_EMAIL',
  'ISTMIYA_TEST_DRIVER_ONE_PASSWORD',
  'ISTMIYA_TEST_DRIVER_TWO_EMAIL',
  'ISTMIYA_TEST_DRIVER_TWO_PASSWORD',
  'ISTMIYA_TEST_BUSINESS_ID',
  'ISTMIYA_TEST_PRODUCT_ID',
  'ISTMIYA_TEST_LATITUDE',
  'ISTMIYA_TEST_LONGITUDE',
];

const requireData = async (result, description) => {
  if (result.error) throw new Error(`${description}: ${result.error.message}`);
  return result.data;
};

test('Sandbox financial order lifecycle', { skip: !enabled }, async (t) => {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  assert.deepEqual(missing, [], `Missing required integration environment variables: ${missing.join(', ')}`);
  assert.equal(
    process.env.ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE,
    'true',
    'Set ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE=true only for a disposable Supabase project.',
  );

  const url = process.env.ISTMIYA_TEST_SUPABASE_URL;
  assert.match(url, /^https?:\/\//, 'The Supabase test URL must use HTTP or HTTPS.');
  const anonKey = process.env.ISTMIYA_TEST_SUPABASE_ANON_KEY;
  const serviceKey = process.env.ISTMIYA_TEST_SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, anonKey);
  const business = createClient(url, anonKey);
  const drivers = [
    createClient(url, anonKey),
    createClient(url, anonKey),
  ];
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await requireData(client.auth.signInWithPassword({
    email: process.env.ISTMIYA_TEST_CLIENT_EMAIL,
    password: process.env.ISTMIYA_TEST_CLIENT_PASSWORD,
  }), 'Sign in test client');
  await requireData(business.auth.signInWithPassword({
    email: process.env.ISTMIYA_TEST_BUSINESS_EMAIL,
    password: process.env.ISTMIYA_TEST_BUSINESS_PASSWORD,
  }), 'Sign in test business');
  await Promise.all(drivers.map((driver, index) => requireData(driver.auth.signInWithPassword({
    email: process.env[`ISTMIYA_TEST_DRIVER_${index === 0 ? 'ONE' : 'TWO'}_EMAIL`],
    password: process.env[`ISTMIYA_TEST_DRIVER_${index === 0 ? 'ONE' : 'TWO'}_PASSWORD`],
  }), `Sign in test driver ${index + 1}`)));

  const clientInfo = await requireData(client.auth.getUser(), 'Read test client profile');
  const optionIds = process.env.ISTMIYA_TEST_OPTION_IDS
    ? JSON.parse(process.env.ISTMIYA_TEST_OPTION_IDS)
    : [];
  assert.ok(Array.isArray(optionIds), 'ISTMIYA_TEST_OPTION_IDS must be a JSON array.');

  const makeOrder = async () => {
    const orderId = await requireData(client.rpc('create_order_with_delivery_v2', {
      p_business_id: process.env.ISTMIYA_TEST_BUSINESS_ID,
      p_items: [{
        product_id: process.env.ISTMIYA_TEST_PRODUCT_ID,
        quantity: 1,
        option_ids: optionIds,
      }],
      p_delivery_latitude: Number(process.env.ISTMIYA_TEST_LATITUDE),
      p_delivery_longitude: Number(process.env.ISTMIYA_TEST_LONGITUDE),
      p_delivery_address: `PRUEBA AUTOMATIZADA ${new Date().toISOString()}`,
      p_delivery_instructions: 'Pedido de prueba en proyecto descartable.',
    }), 'Create test order');
    return requireData(service.from('orders')
      .select('id, client_id, business_id, order_number, total_amount')
      .eq('id', orderId)
      .single(), 'Read test order');
  };

  const preparePayment = async (order) => {
    const paymentLinkId = `istmiya-test-${randomUUID()}`;
    const amountInCents = Math.round(Number(order.total_amount) * 100);
    await requireData(service.from('wompi_payment_links').insert({
      payment_link_id: paymentLinkId,
      purpose: 'order',
      order_id: order.id,
      business_id: order.business_id,
      amount_in_cents: amountInCents,
      status: 'pending',
    }), 'Create simulated test payment link');
    await requireData(service.from('order_payment_attempts').insert({
      order_id: order.id,
      client_id: order.client_id,
      business_id: order.business_id,
      amount_in_cents: amountInCents,
      payment_link_id: paymentLinkId,
      payment_url: `https://checkout.wompi.co/l/${paymentLinkId}`,
      status: 'ready',
    }), 'Create test payment attempt');
    return { paymentLinkId, amountInCents };
  };

  const applyPaymentEvent = async (order, paymentLinkId, amountInCents, status) => requireData(
    service.rpc('apply_wompi_payment', {
      p_transaction_id: `istmiya-test-txn-${randomUUID()}`,
      p_payment_link_id: paymentLinkId,
      p_amount_in_cents: amountInCents,
      p_currency: 'COP',
      p_status: status,
    }),
    `Apply simulated ${status} payment event`,
  );

  await t.test('approved payment, repeated event, cancellation, and refund confirmation are idempotent', async () => {
    const order = await makeOrder();
    const payment = await preparePayment(order);
    const transactionId = `istmiya-test-txn-${randomUUID()}`;
    const event = {
      p_transaction_id: transactionId,
      p_payment_link_id: payment.paymentLinkId,
      p_amount_in_cents: payment.amountInCents,
      p_currency: 'COP',
      p_status: 'APPROVED',
    };
    assert.equal(await requireData(service.rpc('apply_wompi_payment', event), 'Apply approved payment'), true);
    assert.equal(await requireData(service.rpc('apply_wompi_payment', event), 'Repeat approved payment'), false);

    const paidOrder = await requireData(service.from('orders').select('status')
      .eq('id', order.id).single(), 'Read approved order');
    assert.equal(paidOrder.status, 'pagado');

    await requireData(service.rpc('request_order_cancellation', {
      p_order_id: order.id,
      p_actor_id: clientInfo.user.id,
      p_action: 'client_cancel',
    }), 'Cancel paid test order');
    const refund = await requireData(service.from('order_refunds').select('transaction_id, amount_in_cents, status')
      .eq('order_id', order.id).single(), 'Read requested test refund');
    assert.equal(refund.status, 'requested');

    const wompiRefundId = `istmiya-test-refund-${randomUUID()}`;
    const refundRequest = await requireData(service.rpc('claim_order_refund', {
      p_transaction_id: refund.transaction_id,
    }), 'Claim test refund');
    assert.equal(refundRequest.amount_in_cents, payment.amountInCents);
    await requireData(service.rpc('record_order_refund_submission', {
      p_transaction_id: refund.transaction_id,
      p_wompi_refund_id: wompiRefundId,
      p_status: 'pending',
      p_status_message: 'Simulated test submission; no Wompi request was sent.',
    }), 'Set test refund pending');
    await requireData(service.rpc('apply_wompi_refund_event', {
      p_transaction_id: refund.transaction_id,
      p_wompi_refund_id: wompiRefundId,
      p_amount_in_cents: payment.amountInCents,
      p_status: 'APPROVED',
      p_status_message: 'Simulated approved refund event.',
    }), 'Apply test refund confirmation');
    const approvedRefund = await requireData(service.from('order_refunds').select('status')
      .eq('transaction_id', refund.transaction_id).single(), 'Read confirmed test refund');
    assert.equal(approvedRefund.status, 'approved');
  });

  await t.test('unpaid inventory expires after 30 minutes unless its payment is pending', async () => {
    const productId = process.env.ISTMIYA_TEST_PRODUCT_ID;
    const originalProduct = await requireData(service.from('products')
      .select('inventory_enabled, stock_quantity')
      .eq('id', productId)
      .single(), 'Read test product inventory');
    const createdOrderIds = [];

    try {
      await requireData(service.from('products')
        .update({ inventory_enabled: true, stock_quantity: 100 })
        .eq('id', productId), 'Prepare test inventory');

      const order = await makeOrder();
      createdOrderIds.push(order.id);
      await requireData(service.from('orders')
        .update({ created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() })
        .eq('id', order.id), 'Age unpaid test order');
      const payment = await preparePayment(order);
      const transactionId = `istmiya-test-pending-${randomUUID()}`;
      const paymentEvent = {
        p_transaction_id: transactionId,
        p_payment_link_id: payment.paymentLinkId,
        p_amount_in_cents: payment.amountInCents,
        p_currency: 'COP',
      };

      assert.equal(await requireData(service.rpc('apply_wompi_payment', {
        ...paymentEvent,
        p_status: 'PENDING',
      }), 'Record pending test payment'), false);
      await requireData(service.rpc('expire_unpaid_order_reservations'), 'Check pending order expiration');

      const stillPending = await requireData(service.from('orders').select('status')
        .eq('id', order.id).single(), 'Read pending order after expiration check');
      assert.equal(stillPending.status, 'pendiente');

      assert.equal(await requireData(service.rpc('apply_wompi_payment', {
        ...paymentEvent,
        p_status: 'DECLINED',
      }), 'Record declined test payment'), false);
      await requireData(service.rpc('expire_unpaid_order_reservations'), 'Expire declined test payment order');

      const expiredOrder = await requireData(service.from('orders').select('status')
        .eq('id', order.id).single(), 'Read expired order');
      assert.equal(expiredOrder.status, 'cancelado');
      const restoredProduct = await requireData(service.from('products').select('stock_quantity')
        .eq('id', productId).single(), 'Read restored test inventory');
      assert.equal(restoredProduct.stock_quantity, 100);
    } finally {
      for (const orderId of createdOrderIds) {
        await requireData(service.from('orders')
          .update({
            status: 'cancelado',
            cancellation_reason: 'Limpieza de prueba automatizada',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', orderId)
          .eq('status', 'pendiente'), 'Clean up unpaid integration order');
      }
      await requireData(service.from('products')
        .update(originalProduct)
        .eq('id', productId), 'Restore test product inventory settings');
    }
  });

  await t.test('rejected payment can reserve a new attempt; concurrent pickup has one winner and coded delivery settles once', async () => {
    const order = await makeOrder();
    const payment = await preparePayment(order);
    await applyPaymentEvent(order, payment.paymentLinkId, payment.amountInCents, 'DECLINED');

    const failedAttempt = await requireData(service.from('order_payment_attempts').select('status')
      .eq('order_id', order.id).single(), 'Read rejected attempt');
    assert.equal(failedAttempt.status, 'failed');

    const retry = await requireData(service.rpc('reserve_order_payment_link', {
      p_order_id: order.id,
      p_client_id: order.client_id,
    }), 'Reserve payment retry');
    assert.equal(retry.action, 'create');
    const retryLink = `istmiya-test-retry-${randomUUID()}`;
    await requireData(service.rpc('complete_order_payment_link', {
      p_order_id: order.id,
      p_client_id: order.client_id,
      p_payment_link_id: retryLink,
      p_payment_url: `https://checkout.wompi.co/l/${retryLink}`,
    }), 'Complete retry payment link');
    await applyPaymentEvent(order, retryLink, payment.amountInCents, 'APPROVED');

    await requireData(business.rpc('accept_business_order', { p_order_id: order.id }), 'Accept paid order');
    await requireData(business.rpc('mark_order_ready', { p_order_id: order.id }), 'Mark order ready');
    const attempts = await Promise.all(drivers.map((driver) => driver.rpc('driver_accept_order', {
      p_order_id: order.id,
    })));
    const winners = attempts.flatMap((result, index) => result.error ? [] : [index]);
    assert.equal(winners.length, 1, 'Only one concurrent driver may accept the order.');
    const winningDriver = drivers[winners[0]];

    const { data: pickup, error: pickupError } = await business.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    });
    if (pickupError) throw pickupError;
    assert.match(pickup.pickup_code, /^\d{6}$/);
    const wrongPickup = await winningDriver.rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: pickup.pickup_code === '000000' ? '000001' : '000000',
    });
    assert.equal(wrongPickup.error, null);
    assert.equal(wrongPickup.data, false, 'An incorrect pickup code must not advance the order.');
    await requireData(winningDriver.rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: pickup.pickup_code,
    }), 'Verify pickup code');
    await requireData(winningDriver.rpc('driver_start_delivery', { p_order_id: order.id }), 'Start delivery');

    const { data: delivery, error: deliveryError } = await client.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    });
    if (deliveryError) throw deliveryError;
    assert.match(delivery.delivery_code, /^\d{6}$/);
    const wrongDelivery = await winningDriver.rpc('driver_complete_order_with_code', {
      p_order_id: order.id,
      p_code: delivery.delivery_code === '000000' ? '000001' : '000000',
    });
    assert.equal(wrongDelivery.error, null);
    assert.equal(wrongDelivery.data, false, 'An incorrect delivery code must not complete the order.');
    await requireData(winningDriver.rpc('driver_complete_order_with_code', {
      p_order_id: order.id,
      p_code: delivery.delivery_code,
    }), 'Verify delivery code and complete order');

    const settlement = await requireData(service.from('business_settlement_items')
      .select('order_id, status')
      .eq('order_id', order.id)
      .single(), 'Read created business settlement');
    assert.equal(settlement.status, 'available');
  });

  await t.test('five incorrect verification codes lock the driver for 15 minutes', async () => {
    const order = await makeOrder();
    const driverUser = await requireData(drivers[0].auth.getUser(), 'Read test driver profile');
    const driverRecord = await requireData(service.from('drivers').select('id')
      .eq('profile_id', driverUser.user.id).single(), 'Read test driver record');
    await requireData(service.from('orders')
      .update({ driver_id: driverRecord.id, status: 'repartidor_asignado' })
      .eq('id', order.id), 'Prepare order for code lockout test');

    const secret = await requireData(service.from('order_verification_secrets')
      .select('pickup_code').eq('order_id', order.id).single(), 'Read test pickup code');
    const wrongCode = secret.pickup_code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await drivers[0].rpc('driver_verify_order_pickup', {
        p_order_id: order.id,
        p_code: wrongCode,
      });
      assert.equal(result.error, null);
      assert.equal(result.data, false);
    }

    const blockedCorrectCode = await drivers[0].rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: secret.pickup_code,
    });
    assert.equal(blockedCorrectCode.error, null);
    assert.equal(blockedCorrectCode.data, false, 'A correct code must remain blocked during the lockout.');
    const stillAssigned = await requireData(service.from('orders').select('status')
      .eq('id', order.id).single(), 'Read order after code lockout');
    assert.equal(stillAssigned.status, 'repartidor_asignado');
    await requireData(service.from('orders')
      .update({
        status: 'cancelado',
        cancellation_reason: 'Limpieza de prueba automatizada',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', order.id), 'Clean up code lockout test order');
  });
});
