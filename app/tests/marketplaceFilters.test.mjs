import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBusinesses } from '../src/utils/marketplaceFilters.mjs';

const businesses = [
  {
    id: 'food-store',
    store_name: 'Café del Parque',
    address: 'Centro',
    products: [
      { name: 'Arepa de queso', category: 'Comida' },
      { name: 'Torta de chocolate', category: 'Postres' },
    ],
  },
  {
    id: 'pharmacy',
    store_name: 'Farmacia Istmina',
    address: 'Barrio Centro',
    products: [{ name: 'Acetaminofén', category: 'Farmacia' }],
  },
];

test('search finds a business by a product name without accent sensitivity', () => {
  assert.deepEqual(
    filterBusinesses(businesses, 'Todos', 'acetaminofen').map((item) => item.id),
    ['pharmacy'],
  );
});

test('category filters businesses by their real product categories', () => {
  assert.deepEqual(
    filterBusinesses(businesses, 'desserts', '').map((item) => item.id),
    ['food-store'],
  );
});

test('search and category filters are applied together', () => {
  assert.deepEqual(
    filterBusinesses(businesses, 'food', 'arepa').map((item) => item.id),
    ['food-store'],
  );
  assert.deepEqual(filterBusinesses(businesses, 'food', 'acetaminofen'), []);
});
