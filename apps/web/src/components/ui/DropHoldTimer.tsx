import { useEffect, useState } from "react";
import { getDropHoldRemainingMs } from "@/services/dropHold";
import { getReservationRemainingMs } from "@/services/royalDropEngine";

const formatTimer = (ms: number) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
};

export const DropHoldTimer = ({
  userId,
  dropId,
  expiresAt,
  className = "",
}: {
  userId?: string;
  dropId?: string;
  expiresAt?: string | null;
  className?: string;
}) => {
  const getRemaining = () => {
    if (expiresAt) return getReservationRemainingMs(expiresAt);
    if (userId && dropId) return getDropHoldRemainingMs(userId, dropId);
    return 0;
  };
  const [remaining, setRemaining] = useState(getRemaining);

  useEffect(() => {
    setRemaining(getRemaining());
    const interval = setInterval(() => {
      setRemaining(getRemaining());
    }, 1000);
    return () => clearInterval(interval);
  }, [userId, dropId, expiresAt]);

  if (remaining <= 0) return null;

  return (
    <div className={`rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-950 ${className}`.trim()}>
      This item is reserved for you for <span className="font-semibold">{formatTimer(remaining)}</span>
    </div>
  );
};
