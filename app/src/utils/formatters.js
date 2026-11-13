export function formatCOP(value, locale = 'es-419') {
  const amount = Number(value) || 0;
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
  return `$${formatted} COP`;
}
