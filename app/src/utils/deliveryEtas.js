function getEtaTimestamp(etaAt) {
  if (typeof etaAt === 'number') return etaAt;
  if (typeof etaAt !== 'string' || etaAt.trim() === '') return Number.NaN;
  return Date.parse(etaAt);
}

export function getMinutesUntilEta(etaAt, now = Date.now()) {
  const etaTimestamp = getEtaTimestamp(etaAt);
  const nowTimestamp = Number(now);
  if (!Number.isFinite(etaTimestamp) || !Number.isFinite(nowTimestamp)) return null;
  return Math.max(0, Math.ceil((etaTimestamp - nowTimestamp) / 60000));
}

export function getDriverBusinessTargetMinutes(etaAt, now = Date.now()) {
  const remainingMinutes = getMinutesUntilEta(etaAt, now);
  return remainingMinutes === null ? null : Math.max(5, remainingMinutes - 5);
}

export function getCustomerPreparationMinutes(etaAt, now = Date.now()) {
  const remainingMinutes = getMinutesUntilEta(etaAt, now);
  return remainingMinutes === null ? null : remainingMinutes + 5;
}

export function getCustomerDeliveryMinutes(etaAt, now = Date.now()) {
  const remainingMinutes = getMinutesUntilEta(etaAt, now);
  return remainingMinutes === null ? null : remainingMinutes + 10;
}
