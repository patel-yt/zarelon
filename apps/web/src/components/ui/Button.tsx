import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "gold" | "ghost" | "danger";
};

export const Button = ({ className, variant = "gold", ...props }: ButtonProps) => {
  const variantClass =
    variant === "gold"
      ? "btn-primary-contrast"
      : variant === "danger"
        ? "border border-red-600 bg-red-600 text-white hover:bg-red-700"
        : "btn-secondary-contrast hover:border-black";

  return (
    <button
      className={cn(
        "btn-lift-arrow rounded-lg px-4 py-2 text-sm font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30",
        variantClass,
        className
      )}
      {...props}
    />
  );
};
