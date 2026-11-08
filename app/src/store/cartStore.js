// app/src/store/cartStore.js
import { create } from 'zustand';

export const useCartStore = create((set, get) => ({
  items: [], // { id, name, price, quantity, businessId }

  addItem: (product) => {
    const currentItems = get().items;
    const existingItem = currentItems.find(item => item.id === product.id);

    if (existingItem) {
      set({
        items: currentItems.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        ),
      });
    } else {
      set({ items: [...currentItems, { ...product, quantity: 1 }] });
    }
  },

  removeItem: (productId) => {
    set({ items: get().items.filter(item => item.id !== productId) });
  },

  updateQuantity: (productId, amount) => {
    const currentItems = get().items;
    set({
      items: currentItems.map(item => 
        item.id === productId ? { ...item, quantity: Math.max(1, item.quantity + amount) } : item
      ),
    });
  },

  clearCart: () => set({ items: [] }),

  getTotal: () => {
    return get().items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  },
}));
