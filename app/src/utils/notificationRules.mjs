const ADMIN_EVENTS = new Set(['profile_review_pending', 'customer_registered', 'financial_exception', 'inappropriate_language']);

export function notificationIdempotencyKey(event, entityId, recipientId) {
  if (!event || !entityId || !recipientId) throw new Error('event, entityId and recipientId are required');
  return `${event}:${entityId}:${recipientId}`;
}

export function shouldEmailAdminAlert({ role, eventKey, emailEnabled }) {
  return role === 'admin' && emailEnabled === true && (eventKey === 'financial_exception' || eventKey === 'inappropriate_language');
}

export function eligibleAvailableDrivers(drivers) {
  return (drivers || []).filter((driver) => driver.role === 'repartidor' && driver.approved === true && driver.available === true).map((driver) => driver.profileId);
}

export function etaThreeMinuteWindow(etaAt, now = Date.now()) {
  const eta = new Date(etaAt).getTime();
  return Number.isFinite(eta) && eta > now + 2 * 60_000 && eta <= now + 4 * 60_000;
}

export function eventForOrderStatus(status) {
  return ({
    preparando: 'order_preparing', listo_para_repartidor: 'order_ready', repartidor_asignado: 'order_ready',
    recogido: 'order_picked_up', en_camino: 'order_on_the_way',
  })[status] || null;
}

export function isAdminEvent(eventKey) { return ADMIN_EVENTS.has(eventKey); }
