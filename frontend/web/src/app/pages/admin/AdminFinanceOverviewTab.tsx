import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { CircleNotchIcon as Loader2, TrendUpIcon as TrendingUp, TrendDownIcon as TrendingDown, CoinsIcon as Coins } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { formatVND } from "../../utils/currency";

type GroupBy = "day" | "week" | "month" | "quarter";

const GROUP_LABEL: Record<GroupBy, string> = { day: "Ngày", week: "Tuần", month: "Tháng", quarter: "Quý" };

// Mặc định độ dài khoảng thời gian theo từng mức gộp — đủ để thấy xu hướng mà không dồn quá
// nhiều cột nhỏ vào biểu đồ.
const DEFAULT_SPAN_DAYS: Record<GroupBy, number> = { day: 30, week: 12 * 7, month: 12 * 30, quarter: 8 * 91 };

function isoDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function bucketLabel(period: string, groupBy: GroupBy) {
  const d = new Date(period);
  if (groupBy === "day") return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  if (groupBy === "week") return `Tuần ${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}`;
  if (groupBy === "month") return d.toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric" });
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q}/${d.getFullYear()}`;
}

/** Nhãn trục Y ngắn gọn — "12tr", "850k" — trục thật vẫn dùng formatVND đầy đủ trong tooltip. */
function compactVND(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}tr`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

export function AdminFinanceOverviewTab() {
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [from, setFrom] = useState(() => isoDateInput(new Date(Date.now() - DEFAULT_SPAN_DAYS.day * 86_400_000)));
  const [to, setTo] = useState(() => isoDateInput(new Date()));

  const changeGroupBy = (g: GroupBy) => {
    setGroupBy(g);
    setFrom(isoDateInput(new Date(Date.now() - DEFAULT_SPAN_DAYS[g] * 86_400_000)));
    setTo(isoDateInput(new Date()));
  };

  const q = useQuery({
    queryKey: ["admin", "finance-overview", groupBy, from, to],
    queryFn: () =>
      adminService.getFinanceOverview({
        groupBy,
        from: new Date(from).toISOString(),
        // "to" từ <input type=date> là 00:00 của ngày đó — cộng thêm 1 ngày để bao trọn cả
        // ngày cuối cùng admin chọn.
        to: new Date(new Date(to).getTime() + 86_400_000).toISOString(),
      }),
  });

  const report = q.data?.data as
    | {
        buckets: { period: string; income: string; expense: string; netRevenue: string; transactionCount: number }[];
        totals: { income: string; expense: string; netRevenue: string; transactionCount: number };
      }
    | undefined;

  const chartData = useMemo(
    () =>
      (report?.buckets ?? []).map((b) => ({
        label: bucketLabel(b.period, groupBy),
        Thu: Number(b.income),
        Chi: Number(b.expense),
        "Doanh thu ròng": Number(b.netRevenue),
      })),
    [report, groupBy],
  );

  return (
    <div className="space-y-5">
      <p className="text-zinc-500 text-sm">
        Thu = tổng tiền thanh toán thành công qua cổng (gói hội viên, hợp đồng PT, dịch vụ cá
        nhân hoá...). Chi = tiền đã hoàn trả + tiền đã chi trả cho yêu cầu rút tiền. Doanh thu
        ròng = hoa hồng nền tảng thực nhận trên mỗi giao dịch.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
          {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => changeGroupBy(g)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                groupBy === g ? "bg-green-500 text-black" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <label className="flex items-center gap-1.5">
            Từ
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-zinc-200"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Đến
            <input
              type="date"
              value={to}
              min={from}
              max={isoDateInput(new Date())}
              onChange={(e) => setTo(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-zinc-200"
            />
          </label>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : !report ? (
        <p className="text-xs text-zinc-500">Không tải được dữ liệu tài chính.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
              <div className="flex items-center gap-1.5 text-green-400 text-xs font-semibold">
                <TrendingUp className="w-3.5 h-3.5" /> Tổng thu
              </div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{formatVND(Number(report.totals.income))}</div>
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
                <TrendingDown className="w-3.5 h-3.5" /> Tổng chi
              </div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{formatVND(Number(report.totals.expense))}</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                <Coins className="w-3.5 h-3.5" /> Doanh thu ròng nền tảng
              </div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{formatVND(Number(report.totals.netRevenue))}</div>
            </div>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            {chartData.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-10">Không có giao dịch nào trong khoảng thời gian này.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={compactVND}
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111", color: "#f4f4f5" }}
                    formatter={(v: number) => formatVND(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Thu" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="Chi" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="Doanh thu ròng" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800/60">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">{GROUP_LABEL[groupBy]}</th>
                  <th className="text-right px-3 py-2 font-semibold">Thu</th>
                  <th className="text-right px-3 py-2 font-semibold">Chi</th>
                  <th className="text-right px-3 py-2 font-semibold">Doanh thu ròng</th>
                  <th className="text-right px-3 py-2 font-semibold">Số giao dịch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {report.buckets.map((b) => (
                  <tr key={b.period}>
                    <td className="px-3 py-2 text-zinc-300">{bucketLabel(b.period, groupBy)}</td>
                    <td className="px-3 py-2 text-right text-green-400">{formatVND(Number(b.income))}</td>
                    <td className="px-3 py-2 text-right text-red-400">{formatVND(Number(b.expense))}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{formatVND(Number(b.netRevenue))}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{b.transactionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
