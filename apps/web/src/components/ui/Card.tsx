import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Card = ({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("premium-surface rounded-2xl border border-black/10 bg-white p-5", className)}>
    {title ? <h3 className="mb-4 font-heading text-xl text-gold-200">{title}</h3> : null}
    {children}
  </div>
);
