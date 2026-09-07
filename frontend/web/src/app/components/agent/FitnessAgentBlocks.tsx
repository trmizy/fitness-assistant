import { useState } from "react";
import { Link } from "react-router";
import { fitnessAgentService, type AgentChatBlock, type AgentReply } from "../../services/fitnessAgent";
import { isSafeHttpUrl } from "../../utils/safeUrl";

const button = "min-h-11 rounded-lg border border-emerald-600 px-3 py-2 text-sm text-emerald-300 disabled:opacity-50";
const money = (n: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
const focusLabels: Record<string, string> = { SHOULDERS: "Vai", CHEST: "Ngực", BACK: "Lưng", ARMS: "Tay", LEGS: "Chân", GLUTES: "Mông", GENERAL: "Toàn thân" };
export function FitnessAgentBlock({ block, sessionId, onReply }: { block: AgentChatBlock; sessionId?: string; onReply: (reply: AgentReply) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [goal, setGoal] = useState("MUSCLE_GAIN");
  const [focus, setFocus] = useState<string[]>(block.attributes?.focusMuscles ?? []);
  const [muscularity, setMuscularity] = useState(block.attributes?.muscularity ?? "MODERATE");
  const [leanness, setLeanness] = useState(block.attributes?.relativeLeanness ?? "MODERATE");
  const [packages, setPackages] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<AgentReply>) {
    if (busy || completed) return;
    setBusy(true); setError("");
    try { onReply(await fn()); setCompleted(true); }
    catch (e: any) { setError(e.response?.data?.error?.message ?? e.message ?? "Thao tác thất bại. Hãy thử lại."); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 min-w-0 space-y-3 break-words" onClick={e => e.stopPropagation()} aria-busy={busy}>
    {block.warnings?.map(w => <p key={w} className="text-amber-300">{w}</p>)}
    {block.candidates?.map((c, i) => <article key={c.id} className="rounded-xl border border-zinc-700 p-3 space-y-2">
      <div className="flex items-start gap-2">
        {c.photoUrl && isSafeHttpUrl(c.photoUrl) && <img src={c.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />}
        <div className="min-w-0"><h3 className="font-semibold text-zinc-100">{i + 1}. {c.name}</h3>
          <p className="text-emerald-300">Compatibility Score: {c.compatibility?.total}/100</p></div>
      </div>
      {c.dataOrigin === "SYNTHETIC" && <p className="text-xs text-amber-300">Dữ liệu demo · Kết quả synthetic</p>}
      {c.specialties && <p>{c.specialties.join(" · ")}</p>}
      {c.yearsExperience && <p>Kinh nghiệm: {c.yearsExperience}</p>}
      {c.availableDays && <p>Lịch: {c.availableDays.map((d: number) => d === 7 ? "CN" : `T${d + 1}`).join(" · ")}</p>}
      {c.daysPerWeek && <p>{c.daysPerWeek} buổi/tuần · {c.durationWeeks} tuần · khoảng {c.estimatedMinutes} phút/buổi</p>}
      {c.reviewCount > 0 && <p>Đánh giá {Number(c.averageRating).toFixed(1)}/5 ({c.reviewCount} lượt)</p>}
      <details><summary className="cursor-pointer min-h-11 py-2">Lý do và bằng chứng</summary>
        <ul className="list-disc pl-5">{c.why?.map((w: string) => <li key={w}>{w}</li>)}</ul>
        {c.history && <div className="mt-2 text-xs space-y-1">
          <p>{c.history.count > 0 ? `${c.history.count} journey tương đồng` : "Chưa đủ bằng chứng lịch sử."}</p>
          {c.history.medianTrainingAdherence != null && <p>Tuân thủ tập trung vị: {Math.round(c.history.medianTrainingAdherence * 100)}%</p>}
          {c.history.medianWeightChange != null && <p>Thay đổi cân nặng trung vị: {Number(c.history.medianWeightChange).toFixed(1)} kg / {c.history.medianDurationWeeks} tuần</p>}
          <p>{c.history.note}</p>
        </div>}
        {c.certificates?.map((cert: any, n: number) => <p className="text-xs" key={n}>{cert.name} · {cert.issuer} · {cert.verificationStatus}</p>)}
        {c.days?.map((day: any, n: number) => <div key={n} className="mt-2"><strong>Buổi {n + 1}</strong>{day.exercises?.map((e: any) => <p key={e.exerciseId}>{e.name}: {e.sets} × {e.reps}</p>)}</div>)}
      </details>
      {c.packages?.length > 0 && <label className="block">Gói dịch vụ
        <select aria-label={`Gói của ${c.name}`} value={packages[c.id] ?? c.packages[0].id} onChange={e => setPackages(p => ({ ...p, [c.id]: e.target.value }))} className="block w-full min-h-11 rounded bg-zinc-800 p-2 mt-1">
          {c.packages.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {p.sessions} buổi · {money(p.price)}</option>)}
        </select></label>}
      <div className="flex flex-wrap gap-2">
        {c.packages && c.dataOrigin !== "SYNTHETIC" && <Link className={button} to={`/client/services?tab=coaches&ptId=${encodeURIComponent(c.id)}`}>Xem hồ sơ</Link>}
        <button className={button} disabled={busy || completed || (c.packages && c.dataOrigin === "SYNTHETIC")}
          onClick={() => void run(() => fitnessAgentService.choose(block.recommendationId!, c.id, packages[c.id] ?? c.packages?.[0]?.id))}>
          {completed ? "Đã chọn" : c.packages ? "Chọn PT" : "Áp dụng plan"}</button>
      </div>
    </article>)}
    {block.evidence?.length ? <details><summary className="min-h-11 py-2 cursor-pointer">Nguồn khoa học ({block.evidence.length})</summary>
      {block.evidence.map(e => <div key={e.id} className="mb-3 text-xs"><a href={isSafeHttpUrl(e.sourceUrl) ? e.sourceUrl : undefined} target="_blank" rel="noreferrer" className="text-cyan-300 underline">{e.title}</a><p>{e.evidenceLevel}</p><p>{e.finding}</p></div>)}
    </details> : null}
    {block.type === "ACTION_CONFIRMATION" && <div className="rounded-xl border border-amber-600/60 p-3 space-y-2">
      <h3 className="font-semibold">{block.title}</h3>
      {block.summary?.ptName && <p>PT: {block.summary.ptName}</p>}
      {block.summary?.name && <p>Gói: {block.summary.name}</p>}
      {block.summary?.price != null && <p>Tổng giá: {money(block.summary.price)}</p>}
      {block.summary?.sessions && <p>{block.summary.sessions} buổi · {block.summary.sessionMinutes} phút · {block.summary.mode === "ONLINE" ? "Online" : "Trực tiếp"}</p>}
      {block.summary?.preferences?.days && <p>Lịch mong muốn: {block.summary.preferences.days.map((d: number) => d === 7 ? "CN" : `T${d + 1}`).join(" · ")}</p>}
      {block.summary?.durationWeeks && <p>{block.summary.days} buổi/tuần · {block.summary.durationWeeks} tuần</p>}
      <p>{block.note}</p>
      <button className={button} disabled={busy || completed || (!!block.expiresAt && new Date(block.expiresAt) < new Date())} onClick={() => void run(() => fitnessAgentService.confirm(block.actionId!))}>{busy ? "Đang xử lý…" : completed ? "Đã xác nhận" : "Xác nhận"}</button>
      <button className="min-h-11 px-3" disabled={busy || completed} onClick={() => setCompleted(true)}>Để sau</button>
    </div>}
    {block.type === "GOAL_ANALYSIS" && <div className="space-y-3">
      <p>{block.note}</p>
      {!block.attributes?.usable && <p className="text-amber-300">Ảnh chưa đủ rõ để gợi ý. Bạn có thể nhập mục tiêu thủ công bên dưới.</p>}
      <label className="block">Mục tiêu chính<select aria-label="Mục tiêu chính" value={goal} onChange={e => setGoal(e.target.value)} className="block min-h-11 w-full bg-zinc-800 rounded p-2"><option value="MUSCLE_GAIN">Tăng cơ</option><option value="WEIGHT_LOSS">Giảm mỡ</option><option value="MAINTENANCE">Duy trì</option><option value="ATHLETIC_PERFORMANCE">Hiệu suất thể thao</option></select></label>
      <label className="block">Mức phát triển cơ mong muốn<select aria-label="Mức phát triển cơ" value={muscularity} onChange={e => setMuscularity(e.target.value)} className="block min-h-11 w-full bg-zinc-800 rounded p-2"><option value="LOW">Nhẹ</option><option value="MODERATE">Vừa</option><option value="HIGH">Rõ nét</option></select></label>
      <label className="block">Diện mạo mong muốn<select aria-label="Diện mạo mong muốn" value={leanness} onChange={e => setLeanness(e.target.value)} className="block min-h-11 w-full bg-zinc-800 rounded p-2"><option value="MODERATE">Cân đối</option><option value="LEAN_APPEARANCE">Gọn, rõ nét</option><option value="VERY_LEAN_APPEARANCE">Rất rõ nét (cần chuyên gia tư vấn)</option></select></label>
      <fieldset><legend>Nhóm cơ ưu tiên</legend><div className="flex flex-wrap gap-2">{Object.entries(focusLabels).map(([key, label]) => <label key={key} className="min-h-11 flex gap-2 items-center"><input type="checkbox" checked={focus.includes(key)} onChange={e => setFocus(v => e.target.checked ? [...v, key] : v.filter(k => k !== key))} />{label}</label>)}</div></fieldset>
      <button className={button} disabled={busy || completed || !sessionId} onClick={() => void run(() => fitnessAgentService.confirmGoal(sessionId!, { primaryGoal: goal, focusMuscles: focus, muscularity, relativeLeanness: leanness, source: block.attributes?.usable ? "REFERENCE_IMAGE" : "MANUAL", confirmedByUser: true }))}>Đúng, lưu mục tiêu này</button>
    </div>}
    {block.type === "ACTION_RESULT" && <p role="status">{block.goalConfirmed ? "Đã lưu mục tiêu. Bạn có thể yêu cầu gợi ý PT hoặc chương trình tập." : "Thao tác đã hoàn tất."} {block.nextUrl && ["/client/contracts", "/client/training"].includes(block.nextUrl) && <Link className="text-emerald-300 underline" to={block.nextUrl}>Mở chi tiết</Link>}</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
