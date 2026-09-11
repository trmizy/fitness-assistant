import { useState } from "react";
import { Link } from "react-router";
import { fitnessAgentService, type AgentChatBlock, type AgentReply } from "../../services/fitnessAgent";
import { isSafeHttpUrl } from "../../utils/safeUrl";

const button = "min-h-11 rounded-lg border border-emerald-600 px-3 py-2 text-sm text-emerald-300 disabled:opacity-50";
const money = (n: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
// Exported so GuidedRoadmapWizard's own goal-image result card (Step 3) uses the exact same
// Vietnamese muscle-group labels as this chat block — one source of truth for the wording.
export const focusLabels: Record<string, string> = { SHOULDERS: "Vai", CHEST: "Ngực", BACK: "Lưng", ARMS: "Tay", LEGS: "Chân", GLUTES: "Mông", GENERAL: "Toàn thân" };
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
      {block.kind === "CREATE_PLAN_BUNDLE" && <div className="space-y-1.5 rounded-lg border border-zinc-700 p-2.5 text-xs">
        {block.summary?.roadmapSummary && <p className="text-zinc-200">{block.summary.roadmapSummary}</p>}
        {block.summary?.phaseCount > 0 && <p>📅 Lộ trình: {block.summary.phaseCount} giai đoạn · {block.summary.totalWeeks} tuần</p>}
        {block.summary?.workoutName
          ? <p>🏋️ Chương trình tập: {block.summary.workoutName} · {block.summary.workoutDaysPerWeek} buổi/tuần</p>
          : <p className="text-amber-300">🏋️ Chưa tìm được chương trình tập phù hợp — phần này sẽ bị bỏ qua khi xác nhận.</p>}
        <p>🥗 Dinh dưỡng: sẽ tính tự động từ hồ sơ/InBody hiện tại khi xác nhận.</p>
      </div>}
      {block.kind === "SAVE_GENERATED_PLAN" && <div className="space-y-1.5 rounded-lg border border-zinc-700 p-2.5 text-xs">
        <p>🏋️ {block.summary?.planName} · {block.summary?.daysPerWeek} buổi/tuần · {block.summary?.durationWeeks} tuần</p>
        <p className="text-amber-300">Sẽ thay thế lịch tập chưa hoàn thành hiện tại của bạn.</p>
      </div>}
      {block.kind === "ROADMAP_ADVANCE" && <div className="space-y-1.5 rounded-lg border border-zinc-700 p-2.5 text-xs">
        <p>📍 Giai đoạn hiện tại: {block.summary?.currentPhase ?? "?"}</p>
        <p>➡️ Giai đoạn tiếp theo: {block.summary?.nextPhase ?? "?"}</p>
      </div>}
      {block.kind === "ROADMAP_REBUILD" && <div className="space-y-1.5 rounded-lg border border-zinc-700 p-2.5 text-xs">
        <p>🔁 Xây lại {block.summary?.phaseCount} giai đoạn còn lại</p>
        {Array.isArray(block.summary?.phases) && block.summary.phases.length > 0 && <ul className="list-disc pl-4 text-zinc-400">{block.summary.phases.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>}
        <p className="text-amber-300">Các giai đoạn chưa bắt đầu hiện tại sẽ bị thay thế.</p>
      </div>}
      {block.kind === "ROADMAP_ARCHIVE" && <div className="space-y-1.5 rounded-lg border border-zinc-700 p-2.5 text-xs">
        <p>🗄️ {block.summary?.isDraft ? "Bản nháp" : "Lộ trình đang hoạt động"} · mục tiêu {block.summary?.goalType ?? "?"}</p>
        <p className="text-amber-300">Lộ trình sẽ không còn hoạt động sau khi xác nhận.</p>
      </div>}
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
    {block.type === "IMAGE_CHAT" && block.result && <div className="space-y-2 rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-3 text-sm">
      {block.result.type === "EQUIPMENT" && <>
        <p className="font-semibold text-zinc-100">{block.result.equipmentName}</p>
        {block.result.targetMuscles.length > 0 && <div className="flex flex-wrap gap-1.5">
          {block.result.targetMuscles.map(m => <span key={m} className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">{focusLabels[m] ?? m}</span>)}
        </div>}
        {block.result.howToUse && <p><span className="text-zinc-500">Cách dùng: </span>{block.result.howToUse}</p>}
        {block.result.safetyNote && <p className="text-amber-300">{block.result.safetyNote}</p>}
      </>}
      {block.result.type === "WORKOUT_SCHEDULE" && <>
        {block.result.summary && <p className="text-zinc-200">{block.result.summary}</p>}
        {block.result.days.map((d, i) => <div key={i} className="text-xs">
          <p className="font-semibold text-zinc-300">{d.label}</p>
          <ul className="list-disc pl-4 text-zinc-400">{d.exercises.map((ex, j) => <li key={j}>{ex}</li>)}</ul>
        </div>)}
        {block.result.days.length === 0 && <p className="text-xs text-amber-300">Không đọc rõ được lịch tập từ ảnh — bạn có thể mô tả bằng lời.</p>}
      </>}
      <p className="text-zinc-200">{block.result.answer}</p>
    </div>}
    {block.type === "ACTION_RESULT" && <div role="status" className="space-y-1.5">
      <p>{block.message ?? (block.goalConfirmed ? "Đã lưu mục tiêu. Bạn có thể yêu cầu gợi ý PT hoặc chương trình tập." : "Thao tác đã hoàn tất.")}</p>
      {Array.isArray(block.steps) && <ul className="space-y-0.5 text-xs">{block.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>}
      {block.nextUrl && ["/client/contracts", "/client/training", "/client/dashboard"].includes(block.nextUrl) && <Link className="text-emerald-300 underline" to={block.nextUrl}>Mở chi tiết</Link>}
    </div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
