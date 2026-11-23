const CATEGORY_TERMS = {
  food: ['food', 'comida', 'restaurante', 'restaurant', 'almuerzo', 'hamburguesa', 'pizza'],
  groceries: ['groceries', 'grocery', 'supermercado', 'mercado', 'abarrotes'],
  pharmacy: ['pharmacy', 'farmacia', 'medicamento', 'medicina'],
  services: ['services', 'service', 'servicio', 'servicios'],
  desserts: ['desserts', 'dessert', 'postre', 'postres', 'reposteria', 'dulce'],
};

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .trim();

export function filterBusinesses(businesses, category, searchText) {
  const query = normalize(searchText);
  const categoryTerms = CATEGORY_TERMS[category] || [];

  return businesses.filter((business) => {
    const products = business.products || [];
    const businessCategory = normalize(business.category);
    const businessType = normalize(business.business_type);
    const matchesBusinessCategory = [businessCategory, businessType]
      .some((value) => categoryTerms.some((term) => value.includes(normalize(term))));
    const matchesProductCategory = products.some((product) => {
      const productCategory = normalize(product.category);
      return categoryTerms.some((term) => productCategory.includes(normalize(term)));
    });
    const matchesCategory = category === 'Todos' || matchesBusinessCategory || matchesProductCategory;
    if (!matchesCategory) return false;
    if (!query) return true;

    const businessText = normalize(`${business.store_name} ${business.address} ${business.description}`);
    const productText = products
      .map((product) => `${product.name} ${product.description} ${product.category}`)
      .map(normalize)
      .join(' ');
    return businessText.includes(query) || productText.includes(query);
  });
}
