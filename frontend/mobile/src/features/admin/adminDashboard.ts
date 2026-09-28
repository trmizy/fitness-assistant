/**
 * AD-01 "Tổng quan" — phần thuần. Hình dạng là câu trả lời thật của gateway `GET /admin/dashboard`
 * (đã gọi 28/9): `kpis`, `money`, `monitor`, `systemAlerts`, `userGrowth`, `roleData`, `ocrStats`,
 * `recentUsers`.
 *
 * Hai chỗ lệch web, có chủ ý:
 * - **Sức khoẻ hệ thống nói bằng số đếm**, không bằng `healthScore`. Đã thấy thật: `healthScore 100`
 *   trong khi `healthyCount 6 / serviceCount 7` và có cảnh báo lỗi n8n — web in "All Systems
 *   Operational" cho đúng trường hợp đó. "6/7 dịch vụ" thì không nói dối được.
 * - Nhãn tiếng Việt, không in tên enum hay tiếng Anh của gateway ra màn hình.
 */
import { money } from "../wallet/wallet";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

export type DashboardKpis = {
  totalUsers: number;
  verifiedPTs: number;
  pendingPT: number;
  activeContracts: number;
  sessionsToday: number;
};

export function dashboardData(raw: unknown): Record<string, any> {
  const d = (raw as any)?.data ?? raw;
  return d && typeof d === "object" ? d : {};
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function dashboardKpis(d: Record<string, any>): DashboardKpis {
  const k = d.kpis ?? {};
  return {
    totalUsers: num(k.totalUsers),
    verifiedPTs: num(k.verifiedPTs),
    pendingPT: num(k.pendingPT),
    activeContracts: num(k.activeContracts),
    sessionsToday: num(k.sessionsToday),
  };
}

/**
 * Tiền trên nền tảng + sổ có cân không. `balanced` thiếu thì KHÔNG coi là cân — một con số đối soát
 * không có thì phải nói là không biết, chứ không được hiện dấu tích xanh.
 */
export function moneyHeadline(d: Record<string, any>) {
  const m = d.money;
  if (!m || typeof m !== "object") return null;
  return {
    escrow: money(m.escrow),
    platformRevenue: money(m.platformRevenue),
    balanced: m.balanced === true ? true : m.balanced === false ? false : null,
  };
}

export function healthSummary(d: Record<string, any>): { label: string; tone: StatusTone } | null {
  const m = d.monitor;
  if (!m || typeof m !== "object") return null;
  const ok = num(m.healthyCount);
  const all = num(m.serviceCount);
  if (all <= 0) return null;
  if (ok >= all) return { label: `${ok}/${all} dịch vụ hoạt động`, tone: "success" };
  return { label: `${ok}/${all} dịch vụ hoạt động`, tone: ok === 0 ? "danger" : "warning" };
}

const ALERT_RANK: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export type SystemAlert = { level: string; service: string; message: string; time: string; tone: StatusTone };

/** Cảnh báo nặng nhất lên đầu — người trực hệ thống cần thấy cái đang hỏng trước. */
export function systemAlerts(d: Record<string, any>): SystemAlert[] {
  const list = Array.isArray(d.systemAlerts) ? d.systemAlerts : [];
  return list
    .filter((a: any) => a && (a.message || a.service))
    .map((a: any) => {
      const level = String(a.level ?? "info").toLowerCase();
      const tone: StatusTone = level === "critical" || level === "error" ? "danger" : level === "warning" ? "warning" : "info";
      return { level, service: String(a.service ?? ""), message: String(a.message ?? ""), time: String(a.time ?? ""), tone };
    })
    .sort((a: SystemAlert, b: SystemAlert) => (ALERT_RANK[a.level] ?? 9) - (ALERT_RANK[b.level] ?? 9));
}

const MONTH_VI: Record<string, string> = {
  Jan: "T1", Feb: "T2", Mar: "T3", Apr: "T4", May: "T5", Jun: "T6",
  Jul: "T7", Aug: "T8", Sep: "T9", Oct: "T10", Nov: "T11", Dec: "T12",
};

export function userGrowth(d: Record<string, any>): { label: string; users: number }[] {
  const list = Array.isArray(d.userGrowth) ? d.userGrowth : [];
  return list.map((p: any) => ({ label: MONTH_VI[String(p?.month)] ?? String(p?.month ?? ""), users: num(p?.users) }));
}

const ROLE_VI: Record<string, string> = {
  Clients: "Khách hàng",
  Client: "Khách hàng",
  Trainers: "Huấn luyện viên",
  PT: "Huấn luyện viên",
  "Gym owners": "Chủ phòng gym",
  "Gym Owner": "Chủ phòng gym",
  Admins: "Quản trị viên",
  Admin: "Quản trị viên",
};

export function roleBreakdown(d: Record<string, any>): { label: string; value: number }[] {
  const list = Array.isArray(d.roleData) ? d.roleData : [];
  return list
    .map((r: any) => ({ label: ROLE_VI[String(r?.name)] ?? String(r?.name ?? ""), value: num(r?.value) }))
    .filter((r: { value: number }) => r.value > 0);
}

/**
 * Tổng theo vai trò mà gateway trả về có khớp tổng người dùng không. Không khớp thì màn hình nói
 * thẳng phần còn lại là "chưa phân loại", thay vì để hai con số mâu thuẫn nằm cạnh nhau (thấy thật
 * 28/9: 143 + 8 = 151 trên 205 trước khi sửa GAP-21; sau khi sửa, gateway có thêm cột chủ gym và phần
 * này về 0 — giữ lại làm lưới an toàn nếu sau này có vai trò mới).
 */
export function unclassifiedUsers(d: Record<string, any>): number {
  const total = dashboardKpis(d).totalUsers;
  const sum = roleBreakdown(d).reduce((s, r) => s + r.value, 0);
  return Math.max(0, total - sum);
}

export function ocrStats(d: Record<string, any>) {
  const o = d.ocrStats;
  if (!o || typeof o !== "object") return null;
  return { total: num(o.total), extracted: num(o.extracted), manual: num(o.manual), pending: num(o.pending) };
}

export type RecentUser = { name: string; email: string; role: string; joined: string; active: boolean };

export function recentUsers(d: Record<string, any>): RecentUser[] {
  const list = Array.isArray(d.recentUsers) ? d.recentUsers : [];
  return list.map((u: any) => ({
    name: String(u?.name ?? u?.email ?? ""),
    email: String(u?.email ?? ""),
    role: ROLE_VI[String(u?.role)] ?? String(u?.role ?? ""),
    joined: String(u?.joined ?? ""),
    active: String(u?.status ?? "").toLowerCase() === "active",
  }));
}
