import { clsx, type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]): string => clsx(inputs);

export const formatINR = (amountMinor: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);

export const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export const calculateDiscountedPrice = (priceInr: number, discountPercent: number): number => {
  if (discountPercent <= 0) return priceInr;
  return Math.round(priceInr * (1 - discountPercent / 100));
};

export const calculateEffectivePrice = (
  priceInr: number,
  productDiscountPercent: number,
  festivalDiscountPercent = 0
): number => {
  const firstPass = calculateDiscountedPrice(priceInr, productDiscountPercent);
  return calculateDiscountedPrice(firstPass, festivalDiscountPercent);
};

export const formatCountdown = (targetISO: string): string => {
  const now = Date.now();
  const target = new Date(targetISO).getTime();
  const diff = Math.max(target - now, 0);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  return `${days}d ${hours}h ${minutes}m`;
};
