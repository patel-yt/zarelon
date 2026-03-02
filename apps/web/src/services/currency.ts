import { supabase } from "@/lib/supabase";
import type { Currency } from "@/types/domain";

const FALLBACK: Currency = {
  code: "INR",
  symbol: "Rs",
  exchange_rate: 1,
  country: "IN",
  is_active: true,
};

const normalize = (row: any): Currency => ({
  code: String(row.code ?? "INR"),
  symbol: String(row.symbol ?? "Rs"),
  exchange_rate: Number(row.exchange_rate ?? 1),
  country: String(row.country ?? "IN"),
  is_active: Boolean(row.is_active ?? true),
});

const regionToCurrency: Record<string, string> = {
  IN: "INR",
  US: "USD",
  GB: "USD",
  EU: "EUR",
  FR: "EUR",
  DE: "EUR",
  IT: "EUR",
  ES: "EUR",
};

export const detectUserRegion = (): string => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-IN";
    const token = locale.split("-")[1]?.toUpperCase() ?? "IN";
    return token;
  } catch {
    return "IN";
  }
};

export const fetchActiveCurrencies = async (): Promise<Currency[]> => {
  const { data, error } = await supabase.from("currencies").select("*").eq("is_active", true).order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalize);
};

export const resolveUserCurrency = async (): Promise<Currency> => {
  try {
    const region = detectUserRegion();
    const targetCode = regionToCurrency[region] ?? "INR";
    const { data, error } = await supabase.from("currencies").select("*").eq("code", targetCode).maybeSingle();
    if (!error && data) return normalize(data);
    const inr = await supabase.from("currencies").select("*").eq("code", "INR").maybeSingle();
    if (!inr.error && inr.data) return normalize(inr.data);
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
};

export const convertFromINR = (amountInr: number, currency: Currency): number => {
  const inr = Math.max(0, Number(amountInr ?? 0));
  const rate = Math.max(0.000001, Number(currency.exchange_rate ?? 1));
  return inr * rate;
};

export const formatCurrencyAmount = (amountInr: number, currency: Currency): string => {
  const value = convertFromINR(amountInr, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.code,
      maximumFractionDigits: currency.code === "INR" ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency.symbol}${value.toFixed(currency.code === "INR" ? 0 : 2)}`;
  }
};
