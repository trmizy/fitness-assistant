import { BarbellIcon as Dumbbell, MapPinIcon as MapPin, StorefrontIcon as Storefront } from "@phosphor-icons/react";

export interface BasicInfoValue {
  name: string;
  description: string;
  phone: string;
  email: string;
}

const DESC_MIN = 150;
const DESC_MAX = 300;

const inputClass =
  "w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50";

function emailLooksValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 1 "Basic Information": brand read-only context,
 * branch name, short description (with a 150-300 char length guide), contact phone/email,
 * plus a live branch-card preview so the owner sees roughly what members will see. */
export function StepBasicInfo({
  brandName,
  value,
  onChange,
}: {
  brandName: string;
  value: BasicInfoValue;
  onChange: (next: BasicInfoValue) => void;
}) {
  const descLen = value.description.trim().length;
  const descHint =
    descLen === 0
      ? `Gợi ý ${DESC_MIN}-${DESC_MAX} ký tự — mô tả ngắn gọn về không gian, thiết bị, không khí tập luyện.`
      : descLen < DESC_MIN
        ? `Còn ngắn — nên thêm ít nhất ${DESC_MIN - descLen} ký tự nữa để đủ sức thuyết phục.`
        : descLen > DESC_MAX
          ? `Hơi dài — nên rút gọn còn khoảng ${DESC_MAX} ký tự để dễ đọc.`
          : "Độ dài phù hợp.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Thông tin cơ bản</h1>
        <p className="text-sm text-zinc-500 mt-1">Đặt tên và mô tả cho chi nhánh mới, cùng thông tin liên hệ tại chỗ.</p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Storefront className="size-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Thuộc thương hiệu</p>
          <p className="text-sm font-semibold text-zinc-200 truncate">{brandName}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">
            Tên chi nhánh <span className="text-red-400">*</span>
          </label>
          <input
            aria-label="Tên chi nhánh"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder='Ví dụ: "Gymini Fitness — Quận 1"'
            maxLength={150}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">
            Mô tả ngắn <span className="text-red-400">*</span>
          </label>
          <textarea
            aria-label="Mô tả ngắn"
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            rows={4}
            maxLength={2000}
            placeholder="Không gian rộng rãi, đầy đủ thiết bị hiện đại, có HLV hỗ trợ..."
            className={`${inputClass} resize-none`}
          />
          <div className="flex items-center justify-between mt-1">
            <p className={`text-[11px] ${descLen >= DESC_MIN && descLen <= DESC_MAX ? "text-green-500" : "text-zinc-600"}`}>{descHint}</p>
            <p className="text-[11px] text-zinc-600 shrink-0 ml-2">{descLen} ký tự</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">
              Số điện thoại liên hệ <span className="text-red-400">*</span>
            </label>
            <input
              aria-label="Số điện thoại liên hệ"
              value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
              placeholder="0901 234 567"
              maxLength={20}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">
              Email liên hệ <span className="text-red-400">*</span>
            </label>
            <input
              aria-label="Email liên hệ"
              type="email"
              value={value.email}
              onChange={(e) => onChange({ ...value, email: e.target.value })}
              placeholder="chinhanh@gymini.vn"
              maxLength={200}
              className={inputClass}
            />
            {value.email.length > 0 && !emailLooksValid(value.email) && (
              <p className="text-[11px] text-red-400 mt-1">Email không đúng định dạng</p>
            )}
          </div>
        </div>
      </div>

      {/* §13 — live preview so the owner sees roughly what a member will see. */}
      <div>
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Xem trước thẻ chi nhánh</p>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 max-w-xs">
          <div className="flex items-start justify-between mb-2">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-green-400" />
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-semibold border bg-zinc-700/50 border-zinc-700 text-zinc-400">
              Nháp
            </span>
          </div>
          <div className="text-sm font-bold text-zinc-200 truncate">{value.name || "Tên chi nhánh"}</div>
          <div className="flex items-center gap-1 text-xs text-zinc-500 mt-1">
            <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">Địa chỉ sẽ hiện ở bước tiếp theo</span>
          </div>
          {value.description && <p className="text-xs text-zinc-500 mt-2 line-clamp-2">{value.description}</p>}
        </div>
      </div>
    </div>
  );
}

/** §59 — validate the CURRENT step only, inline, human-readable messages. */
export function validateBasicInfo(value: BasicInfoValue): string[] {
  const issues: string[] = [];
  if (!value.name.trim()) issues.push("Cần đặt tên cho chi nhánh");
  if (!value.description.trim()) issues.push("Cần thêm mô tả ngắn cho chi nhánh");
  if (!value.phone.trim()) issues.push("Cần số điện thoại liên hệ");
  if (!value.email.trim()) issues.push("Cần email liên hệ");
  else if (!emailLooksValid(value.email)) issues.push("Email không đúng định dạng");
  return issues;
}
