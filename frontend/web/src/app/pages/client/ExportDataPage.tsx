import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, ArrowLeft, FileJson, FileSpreadsheet } from "lucide-react";
import { useNavigate } from "react-router";
import { exportService, triggerBrowserDownload } from "../../services/api";

/**
 * Roadmap P2.5 "Export / data portability"
 * (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
 *
 * Strictly read-only — this page never mutates anything, it only
 * downloads what's already there. JSON = everything exportable
 * (workout history + body metrics); CSV = workout history only, one row
 * per set (matching §19's own wording — see the impact analysis).
 */
export function ExportDataPage() {
  const navigate = useNavigate();
  const [isDownloadingJson, setIsDownloadingJson] = useState(false);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);

  const handleDownloadJson = async () => {
    setIsDownloadingJson(true);
    try {
      const { blob, fileName } = await exportService.downloadJson();
      triggerBrowserDownload(blob, fileName);
      toast.success("Đã tải file JSON.");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể xuất dữ liệu.");
    } finally {
      setIsDownloadingJson(false);
    }
  };

  const handleDownloadCsv = async () => {
    setIsDownloadingCsv(true);
    try {
      const { blob, fileName } = await exportService.downloadCsv();
      triggerBrowserDownload(blob, fileName);
      toast.success("Đã tải file CSV.");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Không thể xuất dữ liệu.");
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate("/client/profile")}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại hồ sơ
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Download className="w-5 h-5 text-emerald-400" /> Xuất dữ liệu
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tải toàn bộ dữ liệu của bạn về máy — chỉ đọc, không thay đổi dữ liệu hiện có.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-500/10 border border-sky-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileJson className="w-5 h-5 text-sky-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-200">JSON — toàn bộ dữ liệu</p>
            <p className="text-xs text-zinc-600 mt-0.5">Lịch sử tập luyện đầy đủ và số đo cơ thể</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="export-download-json-button"
          onClick={handleDownloadJson}
          disabled={isDownloadingJson}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 py-2.5 text-xs font-bold text-black"
        >
          {isDownloadingJson && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Tải file JSON
        </button>
      </div>

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-200">CSV — lịch sử tập luyện</p>
            <p className="text-xs text-zinc-600 mt-0.5">Mỗi dòng là một set, mở được bằng Excel/Google Sheets</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="export-download-csv-button"
          onClick={handleDownloadCsv}
          disabled={isDownloadingCsv}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 py-2.5 text-xs font-bold text-black"
        >
          {isDownloadingCsv && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Tải file CSV
        </button>
      </div>
    </div>
  );
}
