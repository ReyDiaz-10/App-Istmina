import { useAuthStore } from '../store/authStore';
import { getRoleTheme } from '../constants/roleTheme';

export function useRoleTheme() {
  const role = useAuthStore((state) => state.profile?.role);
  return getRoleTheme(role);
}
