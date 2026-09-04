import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldWarningIcon as ShieldAlert, DownloadSimpleIcon as Download, UploadSimpleIcon as Upload, TrashIcon as Trash2, CircleNotchIcon as Loader2, XIcon as X } from "@phosphor-icons/react";
import { profileService } from "../../../services/api";
import { useApp } from "../../../context/AppContext";
import { SectionCard } from "./components/SectionCard";
import { LinkRow } from "./components/LinkRow";

/**
 * Settings → Privacy & Data. The delete action below calls the real
 * `DELETE /profile/me` — confirmed to delete ONLY the UserProfile row
 * (+ a fire-and-forget AI-conversation cascade). It does NOT delete the
 * login account, workouts, contracts, payments, or chat history. Per
 * spec §13 ("do not invent an action if the backend does not support safe
 * scoped deletion"), this is labeled for exactly what it does — never
 * "Delete Account" — and the confirmation dialog spells out the real scope
 * before the call fires. See impact analysis §11.
 */
export function PrivacyDataSection() {
  const navigate = useNavigate();
  const { logout } = useApp();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => profileService.deleteProfileData(),
    onSuccess: () => {
      toast.success("Đã xoá dữ liệu hồ sơ");
      logout();
      navigate("/login");
    },
    onError: () => toast.error("Không thể xoá dữ liệu — thử lại sau"),
  });

  return (
    <SectionCard
      id="privacy-data"
      icon={ShieldAlert}
      iconColor="text-rose-400"
      iconBg="bg-rose-500/10 border-rose-500/20"
      title="Quyền riêng tư & Dữ liệu"
      description="Xuất, nhập và quản lý dữ liệu của bạn"
    >
      <LinkRow
        icon={Download}
        label="Xuất dữ liệu"
        description="Tải lịch sử tập luyện và số đo cơ thể về máy (JSON hoặc CSV)"
        to="/client/export-data"
        testId="settings-link-export"
      />
      <LinkRow
        icon={Upload}
        label="Nhập lịch sử tập luyện"
        description="Nhập dữ liệu từ file export của Hevy, Strong hoặc FitNotes"
        to="/client/import-workouts"
        testId="settings-link-import"
      />

      <div className="pt-2 border-t border-zinc-800/60">
        {!confirming ? (
          <button
            type="button"
            data-testid="settings-delete-profile-data"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 text-sm text-rose-400 hover:text-rose-300 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Xoá dữ liệu hồ sơ
          </button>
        ) : (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-2.5">
            <p className="text-xs text-rose-200">
              Thao tác này xoá thông tin hồ sơ (chiều cao, cân nặng, mục tiêu, tuỳ
              chọn tập luyện...) và lịch sử trò chuyện AI.
              <strong className="block mt-1">
                Thao tác này KHÔNG xoá tài khoản đăng nhập, lịch sử tập luyện, hợp
                đồng PT, giao dịch ví, hoặc tin nhắn chat — những dữ liệu đó vẫn
                còn nguyên.
              </strong>
              Không thể hoàn tác.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="settings-delete-profile-data-confirm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 text-white hover:bg-rose-400 disabled:opacity-50"
              >
                {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Xác nhận xoá
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={mutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" /> Huỷ
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
