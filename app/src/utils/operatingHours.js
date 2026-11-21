export function isValidOperatingTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

export function isOperatingRangeValid(opensAt, closesAt) {
  return isValidOperatingTime(opensAt)
    && isValidOperatingTime(closesAt)
    && opensAt < closesAt;
}

export function formatOperatingStatus(status) {
  if (!status?.configured) return 'Horario por confirmar';
  if (status.is_open) {
    return `Abierto ahora · horario: ${status.opens_at} a ${status.closes_at}`;
  }
  if (status.opens_at && status.closes_at) {
    return `${status.message || 'Negocio cerrado'} · horario: ${status.opens_at} a ${status.closes_at}`;
  }
  return status.message || 'Negocio cerrado';
}
