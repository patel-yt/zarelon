import { supabase } from "@/lib/supabase";
import { shippingAddressSchema } from "@/lib/schemas";
import type { ShippingAddress } from "@/types/domain";

export interface CreateAddressInput {
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  isDefault?: boolean;
}

export const fetchAddresses = async (userId: string): Promise<ShippingAddress[]> => {
  const { data, error } = await supabase
    .from("shipping_addresses")
    .select("*")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShippingAddress[];
};

export const createAddress = async (userId: string, input: CreateAddressInput): Promise<ShippingAddress> => {
  const parsed = shippingAddressSchema.parse({
    fullName: input.fullName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country ?? "India",
  });

  if (input.isDefault) {
    await supabase.from("shipping_addresses").update({ is_default: false }).eq("user_id", userId);
  }

  const { data, error } = await supabase
    .from("shipping_addresses")
    .insert({
      user_id: userId,
      label: input.label?.trim() || null,
      full_name: parsed.fullName.trim(),
      phone: parsed.phone.trim(),
      line1: parsed.line1.trim(),
      line2: parsed.line2?.trim() || null,
      city: parsed.city.trim(),
      state: parsed.state.trim(),
      postal_code: parsed.postalCode.trim(),
      country: parsed.country.trim(),
      is_default: Boolean(input.isDefault),
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Could not save address");
  return data as ShippingAddress;
};
