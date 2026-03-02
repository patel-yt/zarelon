import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { creatorApi } from "@/lib/apiClient";

type Period = "today" | "7d" | "30d" | "custom";

export const AdminCreatorAnalyticsPage = () => {
  const [period, setPeriod] = useState<Period>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = useMemo(
    () => ({
      period,
      from: period === "custom" ? fromDate : undefined,
      to: period === "custom" ? toDate : undefined,
    }),
    [period, fromDate, toDate]
  );

  const query = useQuery({
    queryKey: ["admin-creator-analytics", params.period, params.from, params.to],
    queryFn: () => creatorApi.getAdminAnalytics(params),
  });

  return (
    <section className="space-y-5 text-white">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-white/65">Creator Viral Analytics</p>
        <h1 className="mt-2 text-2xl font-semibold">Creator Performance</h1>
      </header>

      <div className="rounded-xl border border-white/10 bg-[#111] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-white/70">
            Filter
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {period === "custom" ? (
            <>
              <label className="grid gap-1 text-xs text-white/70">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
                />
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
                />
              </label>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-white/65">
            <tr>
              <th className="px-3 py-3">Creator</th>
              <th className="px-3 py-3">Code</th>
              <th className="px-3 py-3">Clicks</th>
              <th className="px-3 py-3">Purchases</th>
              <th className="px-3 py-3">Revenue</th>
              <th className="px-3 py-3">Conversion</th>
              <th className="px-3 py-3">ROI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-[#151515]">
            {(query.data?.creators ?? []).map((row: any) => (
              <tr key={String(row.creator_id)}>
                <td className="px-3 py-3">{String(row.creator_name ?? "Creator")}</td>
                <td className="px-3 py-3">{String(row.creator_code ?? "-")}</td>
                <td className="px-3 py-3">{Number(row.click_count ?? 0)}</td>
                <td className="px-3 py-3">{Number(row.purchase_count ?? 0)}</td>
                <td className="px-3 py-3">Rs {Number(row.revenue_generated ?? 0).toLocaleString()}</td>
                <td className="px-3 py-3">{Number(row.conversion_rate ?? 0)}%</td>
                <td className="px-3 py-3">Rs {Number(row.roi ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.isFetched && !(query.data?.creators?.length ?? 0) ? (
          <p className="px-3 py-6 text-sm text-white/70">No creator analytics found for selected range.</p>
        ) : null}
      </div>
    </section>
  );
};
