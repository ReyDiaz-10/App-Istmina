const ROLE_THEMES = {
  cliente: {
    primary: '#F57C00',
    primaryDark: '#E66A00',
    onPrimary: '#FFFFFF',
  },
  negocio: {
    primary: '#123B70',
    primaryDark: '#0B2B52',
    onPrimary: '#FFFFFF',
  },
  repartidor: {
    primary: '#2E7D32',
    primaryDark: '#1B5E20',
    onPrimary: '#FFFFFF',
  },
};

export function getRoleTheme(role) {
  const normalizedRole = typeof role === 'string' ? role.toLowerCase() : 'cliente';
  return ROLE_THEMES[normalizedRole] || ROLE_THEMES.cliente;
}
