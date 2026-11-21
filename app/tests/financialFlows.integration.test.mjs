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
  'ISTMIYA_TEST_RECIPIENT_BUSINESS_EMAIL',
  'ISTMIYA_TEST_RECIPIENT_BUSINESS_PASSWORD',
  'ISTMIYA_TEST_RECIPIENT_BUSINESS_ID',
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
  const recipientBusiness = createClient(url, anonKey);
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
  await requireData(recipientBusiness.auth.signInWithPassword({
    email: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_EMAIL,
    password: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_PASSWORD,
  }), 'Sign in recipient test business');
  await Promise.all(drivers.map((driver, index) => requireData(driver.auth.signInWithPassword({
    email: process.env[`ISTMIYA_TEST_DRIVER_${index === 0 ? 'ONE' : 'TWO'}_EMAIL`],
    password: process.env[`ISTMIYA_TEST_DRIVER_${index === 0 ? 'ONE' : 'TWO'}_PASSWORD`],
  }), `Sign in test driver ${index + 1}`)));

  const clientInfo = await requireData(client.auth.getUser(), 'Read test client profile');
  const optionIds = process.env.ISTMIYA_TEST_OPTION_IDS
    ? JSON.parse(process.env.ISTMIYA_TEST_OPTION_IDS)
    : [];
  assert.ok(Array.isArray(optionIds), 'ISTMIYA_TEST_OPTION_IDS must be a JSON array.');

  const makeOrder = async (quantity = 1) => {
    const orderId = await requireData(client.rpc('create_order_with_delivery_v2', {
      p_business_id: process.env.ISTMIYA_TEST_BUSINESS_ID,
      p_items: [{
        product_id: process.env.ISTMIYA_TEST_PRODUCT_ID,
        quantity,
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

  await t.test('inventory is reserved on order, consumed once on delivery, and availability requests do not create chats', async () => {
    const productId = process.env.ISTMIYA_TEST_PRODUCT_ID;
    const originalProduct = await requireData(service.from('products')
      .select('inventory_enabled, stock_quantity, reserved_quantity, is_available')
      .eq('id', productId)
      .single(), 'Read original test product');
    assert.equal(Number(originalProduct.reserved_quantity || 0), 0, 'Use an isolated product with no outstanding reservations.');
    const orderIds = [];

    try {
      await requireData(service.from('products')
        .update({
          inventory_enabled: true,
          stock_quantity: 3,
          reserved_quantity: 0,
          is_available: true,
        })
        .eq('id', productId), 'Prepare stock-tracked test product');

      const order = await makeOrder();
      orderIds.push(order.id);
      let product = await requireData(service.from('products')
        .select('stock_quantity, reserved_quantity')
        .eq('id', productId)
        .single(), 'Read reserved stock');
      assert.equal(product.stock_quantity, 3, 'Order creation must not consume physical stock.');
      assert.equal(product.reserved_quantity, 1, 'Order creation must reserve the requested unit.');

      const metrics = await requireData(business.rpc('business_product_order_metrics', {
        p_business_id: process.env.ISTMIYA_TEST_BUSINESS_ID,
      }), 'Read product order metrics');
      const productMetric = metrics.find((row) => row.product_id === productId);
      assert.ok(productMetric);
      assert.ok(Number(productMetric.order_count) >= 1);
      assert.ok(Number(productMetric.requested_units) >= 1);

      await requireData(service.from('orders').update({ status: 'entregado' }).eq('id', order.id), 'Commit delivered order stock');
      product = await requireData(service.from('products')
        .select('stock_quantity, reserved_quantity')
        .eq('id', productId)
        .single(), 'Read consumed stock');
      assert.equal(product.stock_quantity, 2);
      assert.equal(product.reserved_quantity, 0);

      await requireData(service.from('orders').update({ status: 'entregado' }).eq('id', order.id), 'Retry delivered status update');
      product = await requireData(service.from('products')
        .select('stock_quantity, reserved_quantity')
        .eq('id', productId)
        .single(), 'Read stock after duplicate delivery update');
      assert.equal(product.stock_quantity, 2, 'A repeated delivered status must not consume stock twice.');
      assert.equal(product.reserved_quantity, 0);

      await requireData(service.from('products').update({ is_available: false }).eq('id', productId), 'Mark product unavailable');
      const firstRequest = await requireData(client.rpc('request_product_availability', {
        p_product_id: productId,
      }), 'Request product availability');
      const duplicateRequest = await requireData(client.rpc('request_product_availability', {
        p_product_id: productId,
      }), 'Repeat availability request');
      assert.equal(firstRequest.request_id, duplicateRequest.request_id, 'Repeated requests must be idempotent while open.');

      const visibleRequests = await requireData(business.from('product_availability_requests')
        .select('id, status')
        .eq('id', firstRequest.request_id)
        .single(), 'Read business availability request');
      assert.equal(visibleRequests.status, 'open');
      await requireData(business.rpc('set_product_availability', {
        p_product_id: productId,
        p_is_available: true,
      }), 'Resolve availability request by updating product status');
      const resolvedRequest = await requireData(service.from('product_availability_requests')
        .select('status')
        .eq('id', firstRequest.request_id)
        .single(), 'Read resolved availability request');
      assert.equal(resolvedRequest.status, 'resolved');

      const cancelledOrder = await makeOrder();
      orderIds.push(cancelledOrder.id);
      await requireData(service.from('orders').update({
        status: 'cancelado',
        cancellation_reason: 'Integration test cancellation',
        cancelled_at: new Date().toISOString(),
      }).eq('id', cancelledOrder.id), 'Cancel reserved test order');
      product = await requireData(service.from('products')
        .select('stock_quantity, reserved_quantity')
        .eq('id', productId)
        .single(), 'Read stock after reservation release');
      assert.equal(product.stock_quantity, 2, 'Cancellation releases reservation without consuming physical stock.');
      assert.equal(product.reserved_quantity, 0);
    } finally {
      for (const orderId of orderIds) {
        await requireData(service.from('orders')
          .update({
            status: 'cancelado',
            cancellation_reason: 'Integration test cleanup',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', orderId)
          .not('status', 'in', '(entregado,cancelado)'), 'Release remaining test reservation');
      }
      await requireData(service.from('products')
        .update(originalProduct)
        .eq('id', productId), 'Restore original test product settings');
    }
  });

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

    await requireData(business.rpc('business_accept_order_with_prep_eta', {
      p_order_id: order.id,
      p_minutes: 20,
    }), 'Accept paid order with its preparation estimate');
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
    await requireData(winningDriver.rpc('driver_start_delivery_with_eta', {
      p_order_id: order.id,
      p_minutes: 15,
    }), 'Start delivery with its arrival estimate');

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

    const incorrectCodeAfterClosure = await winningDriver.rpc('driver_complete_order_with_code', {
      p_order_id: order.id,
      p_code: delivery.delivery_code,
    });
    assert.ok(incorrectCodeAfterClosure.error || incorrectCodeAfterClosure.data === false,
      'A closed order must not be completed a second time.');

    const rating = await requireData(client.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'calificacion',
      p_rating: 5,
      p_message: null,
    }), 'Submit client rating');
    assert.equal(rating.created, true);
    const duplicateRating = await requireData(client.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'calificacion',
      p_rating: 1,
      p_message: null,
    }), 'Retry duplicate client rating');
    assert.equal(duplicateRating.created, false, 'A rating must be unique per author and order.');

    await requireData(client.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'elogio',
      p_rating: null,
      p_message: 'Excelente atención durante la entrega.',
    }), 'Submit client praise');
    await requireData(client.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'sugerencia',
      p_rating: null,
      p_message: 'Sería útil avisar al llegar.',
    }), 'Submit client suggestion');
    await requireData(client.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'queja',
      p_rating: null,
      p_message: 'El pedido llegó después de lo previsto.',
    }), 'Submit private client complaint');

    const visibleToDriver = await requireData(winningDriver.from('delivery_order_feedback')
      .select('id, category, author_display_name')
      .eq('order_id', order.id), 'Read feedback as assigned driver');
    assert.deepEqual(
      visibleToDriver.map((item) => item.category).sort(),
      ['elogio', 'sugerencia'],
      'The driver must not see client ratings or complaints.',
    );
    assert.ok(visibleToDriver.every((item) => item.author_display_name), 'Driver feedback includes the customer name.');

    const invalidResponse = await winningDriver.rpc('respond_to_delivery_feedback', {
      p_feedback_id: visibleToDriver.find((item) => item.category === 'elogio').id,
      p_response_code: 'free_text_is_not_allowed',
    });
    assert.ok(invalidResponse.error, 'A response outside the predefined options must be rejected.');
    const praiseFeedback = await requireData(winningDriver.from('delivery_order_feedback')
      .select('id')
      .eq('order_id', order.id)
      .eq('category', 'elogio')
      .single(), 'Read praise for response');
    assert.equal(await requireData(winningDriver.rpc('respond_to_delivery_feedback', {
      p_feedback_id: praiseFeedback.id,
      p_response_code: 'thanks_for_praise',
    }), 'Send predefined praise response'), true);

    const privateFromClient = await requireData(client.from('delivery_order_feedback')
      .select('category, author_role')
      .eq('order_id', order.id), 'Read feedback as customer');
    assert.deepEqual(
      privateFromClient.map((item) => `${item.author_role}:${item.category}`).sort(),
      ['cliente:calificacion', 'cliente:elogio', 'cliente:queja', 'cliente:sugerencia'],
      'The customer may read their own feedback, including their complaint, but never the driver complaint.',
    );

    const driverRating = await requireData(winningDriver.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'calificacion',
      p_rating: 5,
      p_message: null,
    }), 'Submit driver rating for the just-closed order');
    assert.equal(driverRating.created, true);
    const driverComplaint = await requireData(winningDriver.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'queja',
      p_rating: null,
      p_message: 'El cliente no estaba en el domicilio acordado.',
    }), 'Submit driver complaint for the just-closed order');
    assert.equal(driverComplaint.created, true);

    const ownDriverFeedback = await requireData(winningDriver.from('delivery_order_feedback')
      .select('category, author_role')
      .eq('order_id', order.id)
      .eq('author_role', 'repartidor'), 'Read driver-authored feedback');
    assert.deepEqual(
      ownDriverFeedback.map((item) => item.category).sort(),
      ['calificacion', 'queja'],
      'The driver can read their own feedback without seeing the customer complaint.',
    );

    const privateDriverFeedback = await requireData(client.from('delivery_order_feedback')
      .select('category, author_role')
      .eq('order_id', order.id), 'Confirm driver complaint is private from customer');
    assert.ok(privateDriverFeedback.every((item) => item.author_role === 'cliente'),
      'The customer must never see driver-authored feedback.');

    for (const category of ['elogio', 'sugerencia']) {
      const forbiddenDriverFeedback = await winningDriver.rpc('submit_order_feedback', {
        p_order_id: order.id,
        p_category: category,
        p_rating: null,
        p_message: 'Este comentario no está permitido al repartidor.',
      });
      assert.ok(forbiddenDriverFeedback.error, `A driver cannot submit ${category}.`);
    }

    const closedChatSend = await winningDriver.rpc('send_order_chat_message', {
      p_order_id: order.id,
      p_message: 'Mensaje posterior al cierre',
      p_phone_consent: false,
    });
    assert.ok(closedChatSend.error, 'The driver must not send chat messages after delivery.');
    const closedChatRead = await requireData(winningDriver.from('chats')
      .select('id')
      .eq('order_id', order.id), 'Read chat as assigned driver after delivery');
    assert.deepEqual(closedChatRead, [], 'The driver must not read the conversation after delivery.');
    const clientChatRead = await requireData(client.from('chats')
      .select('id')
      .eq('order_id', order.id), 'Read chat as customer after delivery');
    assert.ok(Array.isArray(clientChatRead), 'The customer retains the existing delivered-order chat read access.');

    const otherDriver = drivers[winners[0] === 0 ? 1 : 0];
    const otherDriverRating = await otherDriver.rpc('submit_order_feedback', {
      p_order_id: order.id,
      p_category: 'calificacion',
      p_rating: 5,
      p_message: null,
    });
    assert.ok(otherDriverRating.error, 'A driver who did not deliver this order cannot submit feedback.');

    const settlement = await requireData(service.from('business_settlement_items')
      .select('order_id, status')
      .eq('order_id', order.id)
      .single(), 'Read created business settlement');
    assert.equal(settlement.status, 'available');
  });

  await t.test('failed delivery requires a confirmed return, cannot settle, and respects participant blocks', async () => {
    const order = await makeOrder();
    const followupOrder = await makeOrder();
    const payment = await preparePayment(order);
    await applyPaymentEvent(order, payment.paymentLinkId, payment.amountInCents, 'APPROVED');
    await requireData(business.rpc('business_accept_order_with_prep_eta', {
      p_order_id: order.id,
      p_minutes: 20,
    }), 'Accept incident test order with preparation estimate');
    await requireData(business.rpc('mark_order_ready', { p_order_id: order.id }), 'Mark incident test order ready');

    await requireData(drivers[0].rpc('driver_accept_order', { p_order_id: order.id }), 'Assign first incident driver');
    const originalCodes = await requireData(business.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    }), 'Read original order codes');
    await requireData(drivers[0].rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: originalCodes.pickup_code,
    }), 'Verify first pickup');
    await requireData(drivers[0].rpc('driver_start_delivery_with_eta', {
      p_order_id: order.id,
      p_minutes: 15,
    }), 'Start first delivery');
    await requireData(drivers[0].rpc('report_order_delivery_failure', {
      p_order_id: order.id,
      p_reason: 'No fue posible contactar al cliente en la dirección indicada.',
    }), 'Report delivery incident');

    const incidentOrder = await requireData(service.from('orders')
      .select('status')
      .eq('id', order.id)
      .single(), 'Read undelivered order');
    assert.equal(incidentOrder.status, 'no_entregado');
    const prematureCompletion = await drivers[0].rpc('driver_complete_order_with_code', {
      p_order_id: order.id,
      p_code: originalCodes.delivery_code,
    });
    assert.ok(prematureCompletion.error, 'An incident order must not be completed with its previous delivery code.');
    const prematureSettlement = await requireData(service.from('business_settlement_items')
      .select('order_id')
      .eq('order_id', order.id)
      .maybeSingle(), 'Check settlement before incident resolution');
    assert.equal(prematureSettlement, null);

    const prematureReassignment = await business.rpc('reassign_returned_order', { p_order_id: order.id });
    assert.ok(prematureReassignment.error, 'The business must confirm the returned package before reassignment.');
    await requireData(business.rpc('confirm_undelivered_return', { p_order_id: order.id }), 'Confirm returned package');
    await requireData(business.rpc('reassign_returned_order', { p_order_id: order.id }), 'Reassign returned order');

    const reassignedOrder = await requireData(service.from('orders')
      .select('status, driver_id')
      .eq('id', order.id)
      .single(), 'Read reassigned order');
    assert.equal(reassignedOrder.status, 'listo_para_repartidor');
    assert.equal(reassignedOrder.driver_id, null);
    const previousDriverRetry = await drivers[0].rpc('driver_accept_order', { p_order_id: order.id });
    assert.ok(previousDriverRetry.error, 'The driver who reported failure cannot take the same order again.');

    await requireData(drivers[1].rpc('driver_accept_order', { p_order_id: order.id }), 'Assign replacement driver');
    const blockState = await requireData(client.rpc('set_order_participant_block', {
      p_order_id: order.id,
      p_blocked: true,
    }), 'Block client-driver direct interaction');
    assert.equal(blockState.pair_blocked, true);

    const blockedClientMessage = await client.rpc('send_order_chat_message', {
      p_order_id: order.id,
      p_message: 'Mensaje que debe ser bloqueado.',
    });
    assert.ok(blockedClientMessage.error);
    const blockedDriverMessage = await drivers[1].rpc('send_order_chat_message', {
      p_order_id: order.id,
      p_message: 'Mensaje que debe ser bloqueado.',
    });
    assert.ok(blockedDriverMessage.error);

    const replacementCodes = await requireData(business.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    }), 'Read rotated verification codes');
    assert.notEqual(replacementCodes.pickup_code, originalCodes.pickup_code);
    assert.notEqual(replacementCodes.delivery_code, originalCodes.delivery_code);
    const retiredPickupCode = await drivers[1].rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: originalCodes.pickup_code,
    });
    assert.equal(retiredPickupCode.error, null);
    assert.equal(retiredPickupCode.data, false);
    await requireData(drivers[1].rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: replacementCodes.pickup_code,
    }), 'Verify replacement pickup');
    await requireData(drivers[1].rpc('driver_start_delivery_with_eta', {
      p_order_id: order.id,
      p_minutes: 12,
    }), 'Continue existing assignment after a block');
    const replacementDeliveryCode = await requireData(client.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    }), 'Read replacement delivery code');
    await requireData(drivers[1].rpc('driver_complete_order_with_code', {
      p_order_id: order.id,
      p_code: replacementDeliveryCode.delivery_code,
    }), 'Complete replacement delivery');

    const settlement = await requireData(service.from('business_settlement_items')
      .select('order_id, status')
      .eq('order_id', order.id)
      .single(), 'Read successful delivery settlement');
    assert.equal(settlement.status, 'available');

    await requireData(service.from('orders')
      .update({ status: 'preparando' })
      .eq('id', followupOrder.id), 'Prepare a later order for assignment check');
    await requireData(business.rpc('business_mark_order_ready_with_eta', {
      p_order_id: followupOrder.id,
      p_minutes: 10,
    }), 'Mark later order ready');
    const blockedAssignment = await drivers[1].rpc('driver_accept_order', {
      p_order_id: followupOrder.id,
    });
    assert.match(blockedAssignment.error?.message || '', /PARTICIPANT_BLOCKED/);

    await requireData(service.from('orders')
      .update({
        status: 'cancelado',
        cancellation_reason: 'Integration test cleanup',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', followupOrder.id), 'Clean up follow-up test order');
  });

  await t.test('cancelling a returned undelivered order records one idempotent refund', async () => {
    const order = await makeOrder();
    const payment = await preparePayment(order);
    const businessUser = await requireData(business.auth.getUser(), 'Read test business profile');
    await applyPaymentEvent(order, payment.paymentLinkId, payment.amountInCents, 'APPROVED');
    await requireData(business.rpc('business_accept_order_with_prep_eta', {
      p_order_id: order.id,
      p_minutes: 20,
    }), 'Accept cancellation test order with preparation estimate');
    await requireData(business.rpc('mark_order_ready', { p_order_id: order.id }), 'Mark cancellation test order ready');
    await requireData(drivers[0].rpc('driver_accept_order', { p_order_id: order.id }), 'Assign cancellation test driver');
    const codes = await requireData(business.rpc('get_order_verification_codes', {
      p_order_id: order.id,
    }), 'Read cancellation test pickup code');
    await requireData(drivers[0].rpc('driver_verify_order_pickup', {
      p_order_id: order.id,
      p_code: codes.pickup_code,
    }), 'Verify cancellation test pickup');
    await requireData(drivers[0].rpc('driver_start_delivery_with_eta', {
      p_order_id: order.id,
      p_minutes: 15,
    }), 'Start cancellation test delivery');
    await requireData(drivers[0].rpc('report_order_delivery_failure', {
      p_order_id: order.id,
      p_reason: 'Dirección inaccesible por cierre vial.',
    }), 'Report cancellation test incident');
    await requireData(business.rpc('confirm_undelivered_return', { p_order_id: order.id }), 'Confirm cancellation test return');

    const cancellation = {
      p_order_id: order.id,
      p_actor_id: businessUser.user.id,
      p_action: 'business_delivery_failed',
    };
    const result = await requireData(service.rpc('request_order_cancellation', cancellation), 'Cancel returned order');
    assert.equal(result.status, 'cancelado');
    const repeated = await requireData(service.rpc('request_order_cancellation', cancellation), 'Retry order cancellation');
    assert.equal(repeated.status, 'cancelado');

    const cancelledOrder = await requireData(service.from('orders')
      .select('status')
      .eq('id', order.id)
      .single(), 'Read cancelled incident order');
    assert.equal(cancelledOrder.status, 'cancelado');
    const refunds = await requireData(service.from('order_refunds')
      .select('transaction_id, reason, status')
      .eq('order_id', order.id), 'Read incident refund request');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].reason, 'business_delivery_failed');
    assert.equal(refunds[0].status, 'requested');
    const incidents = await requireData(service.from('order_delivery_incidents')
      .select('status, returned_at, resolved_at')
      .eq('order_id', order.id)
      .single(), 'Read resolved incident');
    assert.equal(incidents.status, 'cancelled');
    assert.ok(incidents.returned_at);
    assert.ok(incidents.resolved_at);
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

  await t.test('business wallet transfer waits for acceptance and applies once atomically', async () => {
    const senderWallet = await requireData(service.from('wallets').select('id, balance')
      .eq('business_id', process.env.ISTMIYA_TEST_BUSINESS_ID).single(), 'Read sender wallet');
    const recipientWallet = await requireData(service.from('wallets').select('id, balance')
      .eq('business_id', process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID).single(), 'Read recipient wallet');
    const amount = 1;
    assert.ok(Number(senderWallet.balance) >= amount * 2, 'Set a disposable sender wallet balance of at least two COP.');
    const key = randomUUID();
    const transferIds = [];
    try {
      const insufficient = await business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: Number(senderWallet.balance) + 1,
        p_idempotency_key: randomUUID(),
      });
      assert.ok(insufficient.error, 'A proposal above the current balance must be rejected.');
      const forbiddenProposal = await client.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: randomUUID(),
      });
      assert.ok(forbiddenProposal.error, 'A client cannot propose a business wallet transfer.');
      const staleProposal = await requireData(business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: randomUUID(),
      }), 'Propose transfer before balance is spent');
      transferIds.push(staleProposal.id);
      await requireData(service.from('wallets').update({ balance: 0 })
        .eq('id', senderWallet.id), 'Simulate sender spending its balance');
      const insufficientAcceptance = await requireData(recipientBusiness.rpc('respond_business_wallet_transfer', {
        p_transfer_id: staleProposal.id,
        p_accept: true,
      }), 'Reject stale proposal with insufficient balance');
      assert.equal(insufficientAcceptance.status, 'cancelled');
      assert.equal(insufficientAcceptance.reason, 'Sender balance is no longer sufficient');
      await requireData(service.from('wallets').update({ balance: senderWallet.balance })
        .eq('id', senderWallet.id), 'Restore sender balance after insufficient acceptance test');

      const proposed = await requireData(business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: key,
      }), 'Propose wallet transfer');
      transferIds.push(proposed.id);
      const retry = await requireData(business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: key,
      }), 'Retry wallet transfer proposal');
      assert.equal(retry.id, proposed.id);
      assert.equal(retry.status, 'pending');
      const senderPending = await requireData(service.from('wallets').select('balance')
        .eq('id', senderWallet.id).single(), 'Confirm pending proposal does not debit');
      assert.equal(Number(senderPending.balance), Number(senderWallet.balance));
      const recipientPending = await requireData(service.from('wallets').select('balance')
        .eq('id', recipientWallet.id).single(), 'Confirm pending proposal does not credit');
      assert.equal(Number(recipientPending.balance), Number(recipientWallet.balance));
      const senderResponse = await business.rpc('respond_business_wallet_transfer', {
        p_transfer_id: proposed.id, p_accept: true,
      });
      assert.ok(senderResponse.error, 'The sender cannot respond on behalf of the recipient.');
      const concurrentAccepts = await Promise.all([0, 1].map(() => recipientBusiness.rpc(
        'respond_business_wallet_transfer',
        { p_transfer_id: proposed.id, p_accept: true },
      )));
      for (const result of concurrentAccepts) {
        if (result.error) throw new Error(`Concurrent accept failed: ${result.error.message}`);
      }
      assert.deepEqual(
        concurrentAccepts.map((result) => result.data.applied).sort(),
        [false, true],
        'Concurrent acceptance must move the balance exactly once.',
      );
      const repeatedAccept = await requireData(recipientBusiness.rpc('respond_business_wallet_transfer', {
        p_transfer_id: proposed.id, p_accept: true,
      }), 'Retry transfer acceptance');
      assert.equal(repeatedAccept.applied, false);
      const senderAfter = await requireData(service.from('wallets').select('balance')
        .eq('id', senderWallet.id).single(), 'Read sender wallet after transfer');
      const recipientAfter = await requireData(service.from('wallets').select('balance')
        .eq('id', recipientWallet.id).single(), 'Read recipient wallet after transfer');
      assert.equal(Number(senderAfter.balance), Number(senderWallet.balance) - amount);
      assert.equal(Number(recipientAfter.balance), Number(recipientWallet.balance) + amount);
      const entries = await requireData(service.from('business_wallet_transfer_entries')
        .select('entry_type, amount_cop').eq('transfer_id', proposed.id), 'Read transfer ledger');
      assert.equal(entries.length, 2);
      assert.deepEqual(entries.map((entry) => entry.entry_type).sort(), ['transfer_credit', 'transfer_debit']);
      assert.equal(Number(entries[0].amount_cop), Number(entries[1].amount_cop));

      const declinedProposal = await requireData(business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: randomUUID(),
      }), 'Propose transfer for rejection');
      transferIds.push(declinedProposal.id);
      const declined = await requireData(recipientBusiness.rpc('respond_business_wallet_transfer', {
        p_transfer_id: declinedProposal.id,
        p_accept: false,
      }), 'Reject wallet transfer');
      assert.equal(declined.status, 'declined');
      const repeatedDecline = await requireData(recipientBusiness.rpc('respond_business_wallet_transfer', {
        p_transfer_id: declinedProposal.id,
        p_accept: false,
      }), 'Retry transfer rejection');
      assert.equal(repeatedDecline.applied, false);

      const cancelledProposal = await requireData(business.rpc('propose_business_wallet_transfer', {
        p_recipient_business_id: process.env.ISTMIYA_TEST_RECIPIENT_BUSINESS_ID,
        p_amount_cop: amount,
        p_idempotency_key: randomUUID(),
      }), 'Propose transfer for sender cancellation');
      transferIds.push(cancelledProposal.id);
      const cancelled = await requireData(business.rpc('cancel_business_wallet_transfer', {
        p_transfer_id: cancelledProposal.id,
      }), 'Cancel pending transfer as sender');
      assert.equal(cancelled.status, 'cancelled');
    } finally {
      await requireData(service.from('wallets').update({ balance: senderWallet.balance })
        .eq('id', senderWallet.id), 'Restore sender test wallet');
      await requireData(service.from('wallets').update({ balance: recipientWallet.balance })
        .eq('id', recipientWallet.id), 'Restore recipient test wallet');
      for (const transferId of transferIds) {
        await requireData(service.from('business_wallet_transfer_entries').delete()
          .eq('transfer_id', transferId), 'Clean transfer ledger');
        await requireData(service.from('business_wallet_transfers').delete()
          .eq('id', transferId), 'Clean transfer record');
      }
    }
  });

  await t.test('pickup order creation is idempotent and reserves stock once', async () => {
    const key = randomUUID();
    const args = {
      p_business_id: process.env.ISTMIYA_TEST_BUSINESS_ID,
      p_items: [{ product_id: process.env.ISTMIYA_TEST_PRODUCT_ID, quantity: 1, option_ids: optionIds }],
      p_idempotency_key: key,
    };
    let orderId;
    try {
      const first = await requireData(client.rpc('create_pickup_order', args), 'Create pickup order');
      orderId = first;
      const retry = await requireData(client.rpc('create_pickup_order', args), 'Retry pickup order creation');
      assert.equal(retry, first);
      const differentPayloadRetry = await client.rpc('create_pickup_order', {
        ...args,
        p_items: [{ product_id: process.env.ISTMIYA_TEST_PRODUCT_ID, quantity: 2, option_ids: optionIds }],
      });
      assert.ok(differentPayloadRetry.error, 'An idempotency key cannot be reused with different order details.');
      const pickup = await requireData(service.from('orders')
        .select('delivery_mode, delivery_fee_cop, delivery_address, status')
        .eq('id', first).single(), 'Read pickup order');
      assert.equal(pickup.delivery_mode, 'pickup');
      assert.equal(Number(pickup.delivery_fee_cop), 0);
      assert.equal(pickup.delivery_address, 'Retiro en tienda');

      const clientCodes = await client.rpc('get_order_verification_codes', { p_order_id: first });
      assert.ok(clientCodes.error, 'The generic delivery-code RPC must not expose pickup claim codes.');
      const businessCode = await business.rpc('get_pickup_order_code', { p_order_id: first });
      assert.ok(businessCode.error, 'The business cannot retrieve a pickup claim code.');
      const clientClaim = await client.rpc('get_my_pickup_claim_code', { p_order_id: first });
      assert.ok(clientClaim.error, 'A pickup claim code must not be exposed before payment and acceptance.');
      const clientCompletion = await client.rpc('complete_pickup_order_with_code', {
        p_order_id: first,
        p_code: '123456',
      });
      assert.ok(clientCompletion.error, 'The customer cannot mark their own pickup order delivered.');

      const driverUser = await requireData(drivers[0].auth.getUser(), 'Read test driver profile');
      const driverRecord = await requireData(service.from('drivers').select('id')
        .eq('profile_id', driverUser.user.id).single(), 'Read test driver record');
      const assignment = await service.from('orders')
        .update({ driver_id: driverRecord.id, status: 'repartidor_asignado' })
        .eq('id', first);
      assert.ok(assignment.error, 'Pickup orders cannot be assigned to delivery drivers.');
      const unchanged = await requireData(service.from('orders').select('status, driver_id')
        .eq('id', first).single(), 'Confirm pickup assignment was rejected');
      assert.equal(unchanged.status, pickup.status);
      assert.equal(unchanged.driver_id, null);
    } finally {
      if (orderId) {
        await requireData(service.from('orders').update({
          status: 'cancelado',
          cancellation_reason: 'Integration test cleanup',
          cancelled_at: new Date().toISOString(),
        }).eq('id', orderId).not('status', 'in', '(entregado,cancelado)'), 'Release pickup test inventory');
      }
      await requireData(service.from('pickup_order_idempotency').delete()
        .eq('idempotency_key', key), 'Clean pickup idempotency record');
    }
  });
});
