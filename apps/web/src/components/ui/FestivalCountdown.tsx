import { useEffect, useMemo, useState } from "react";

type CountdownPart = {
  label: "Days" | "Hours" | "Mins" | "Secs";
  value: string;
};

const toParts = (endDateIso: string): { expired: boolean; parts: CountdownPart[]; totalSeconds: number } => {
  const diff = new Date(endDateIso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return {
      expired: true,
      totalSeconds: 0,
      parts: [
        { label: "Days", value: "00" },
        { label: "Hours", value: "00" },
        { label: "Mins", value: "00" },
        { label: "Secs", value: "00" },
      ],
    };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return {
    expired: false,
    totalSeconds,
    parts: [
      { label: "Days", value: String(days).padStart(2, "0") },
      { label: "Hours", value: String(hours).padStart(2, "0") },
      { label: "Mins", value: String(mins).padStart(2, "0") },
      { label: "Secs", value: String(secs).padStart(2, "0") },
    ],
  };
};

export const FestivalCountdown = ({ endDateIso }: { endDateIso: string }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const alignDelay = 1000 - (Date.now() % 1000);
    let intervalRef: ReturnType<typeof setInterval> | null = null;
    const timeoutRef = setTimeout(() => {
      setTick((prev) => prev + 1);
      intervalRef = setInterval(() => setTick((prev) => prev + 1), 1000);
    }, alignDelay);

    return () => {
      clearTimeout(timeoutRef);
      if (intervalRef) clearInterval(intervalRef);
    };
  }, []);

  const model = useMemo(() => toParts(endDateIso), [endDateIso, tick]);
  const isUrgent = model.totalSeconds > 0 && model.totalSeconds <= 6 * 60 * 60;

  if (model.expired) {
    return <p className="festival-countdown-expired">Offer ended</p>;
  }

  return (
    <div className={`festival-countdown-grid ${isUrgent ? "is-urgent" : ""}`} role="timer" aria-live="polite">
      {model.parts.map((part) => (
        <div key={part.label} className={`festival-countdown-cell ${part.label === "Secs" ? "is-secs" : ""}`}>
          <p className="festival-countdown-value">{part.value}</p>
          <p className="festival-countdown-label">{part.label}</p>
        </div>
      ))}
    </div>
  );
};
