import type { ReactNode } from "react";
import { MobileFooter } from "@/components/mobile/MobileFooter";

type MobilePageLayoutProps = {
  topNotice?: string;
  children: ReactNode;
};

export const MobilePageLayout = ({ topNotice, children }: MobilePageLayoutProps) => {
  return (
    <div className="md:hidden bg-white pb-0" data-bg="light">
      {topNotice ? (
        <div className="border-y border-black/10 bg-[#f8f8f8] px-4 py-2 text-center text-[12px] text-[#111111]">
          {topNotice}
        </div>
      ) : null}
      <div className="space-y-8 pt-0.5">{children}</div>
      <MobileFooter />
    </div>
  );
};
