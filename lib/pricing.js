// EA fiyat basamakları
export function priceStep(p) {
  if (p < 1000) return 50;
  if (p < 10000) return 100;
  if (p < 50000) return 250;
  if (p < 100000) return 500;
  return 1000;
}
export const roundDown = (p) => { const s = priceStep(p); return Math.floor(p / s) * s; };
export const prevPrice = (p) => (p <= 200 ? 150 : p - priceStep(p - 1));
