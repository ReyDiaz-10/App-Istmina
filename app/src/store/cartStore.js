// app/src/store/cartStore.js
import { create } from 'zustand';

export const useCartStore = create((set, get) => ({
  items: [], // { id, name, price, quantity, businessId }

  addItem: (product) => {
    const currentItems = get().items;
    const optionIds = [...(product.optionIds || [])].sort();
    const cartKey = `${product.id}:${optionIds.join(',')}`;
    const existingItem = currentItems.find((item) => (item.cartKey || `${item.id}:`) === cartKey);

    if (existingItem) {
      set({
        items: currentItems.map(item => 
          (item.cartKey || `${item.id}:`) === cartKey
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ),
      });
    } else {
      set({ items: [...currentItems, { ...product, optionIds, cartKey, quantity: 1 }] });
    }
  },

  removeItem: (cartKey) => {
    set({ items: get().items.filter(item => (item.cartKey || `${item.id}:`) !== cartKey) });
  },

  updateQuantity: (cartKey, amount) => {
    const currentItems = get().items;
    set({
      items: currentItems.map(item => 
        (item.cartKey || `${item.id}:`) === cartKey
          ? { ...item, quantity: Math.max(1, item.quantity + amount) }
          : item
      ),
    });
  },

  clearCart: () => set({ items: [] }),

  getTotal: () => {
    return get().items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  },
}));
