import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { branchPhotoService, gymListingService } from "../../../services/gymListingApi";
import type { ListingPhoto } from "../../../types";
import { PhotosSection, type UploadEntry } from "../../../pages/pt/listing/ListingSections";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { MAX_DRAFT_BRANCH_PHOTOS, gymListingErrorMessage, gymPhotoLimitMessage, movePhoto, photoFileError, photoRoom } from "../../../utils/gymListing";

/**
 * Step 5 "Hình ảnh" of the add-branch wizard. The old disk route answers 410; photos go presign → direct POST to storage → confirm
 * (the server re-encodes the file), and a DRAFT branch keeps them as an ordered gallery: ↑ ↓ reorder, one cover, delete. Photos are
 * STAGED (private) until the branch is approved. Self-contained (owns its query and mutations), like the verification step.
 */
export function StepPhotos({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["gym-photos", gymId];
  const photosQuery = useQuery<ListingPhoto[]>({ queryKey, queryFn: () => branchPhotoService.list(gymId),
    // the list carries short-lived (5 min) presigned links: keep them fresh while the step stays open
    refetchInterval: 4 * 60 * 1000,
  });
  const photos = photosQuery.data ?? [];

  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const seq = useRef(0);

  const ids = photos.map((p) => p.id);
  const cover = (photos.find((p) => p.isCover) ?? photos[0])?.id ?? null;
  const photoMap = new Map(photos.map((p) => [p.id, p]));

  async function guarded(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(gymListingErrorMessage(e, fallback));
      void queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusy(false);
    }
  }

  const uploadOne = async (file: File, key: string) => {
    setUploads((prev) => [...prev.filter((u) => u.key !== key), { key, name: file.name, status: "uploading", file }]);
    try {
      await gymListingService.uploadPhoto(gymId, file);
      setUploads((prev) => prev.filter((u) => u.key !== key));
      await queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      const message = gymListingErrorMessage(e, "Không tải được ảnh. Hãy thử lại.");
      setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, status: "failed", message } : u)));
    }
  };

  const onAdd = async (files: File[]) => {
    const inFlight = uploads.filter((u) => u.status === "uploading").length;
    const room = photoRoom(photos.length + inFlight, MAX_DRAFT_BRANCH_PHOTOS);
    if (room <= 0) {
      toast.error(gymPhotoLimitMessage(MAX_DRAFT_BRANCH_PHOTOS));
      return;
    }
    const accepted: File[] = [];
    for (const f of files) {
      const problem = photoFileError(f);
      if (problem) toast.error(`${f.name}: ${problem}`);
      else accepted.push(f);
    }
    if (accepted.length > room) toast.error(`Chỉ còn chỗ cho ${room} ảnh nữa — các ảnh thừa đã được bỏ qua.`);
    for (const file of accepted.slice(0, room)) {
      seq.current += 1;
      await uploadOne(file, `upload-${seq.current}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Hình ảnh</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Thư viện ảnh của chi nhánh — khách xem được sau khi chi nhánh được duyệt. Tối đa {MAX_DRAFT_BRANCH_PHOTOS} ảnh, JPG/PNG/WEBP.
        </p>
      </div>

      {photosQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <CircleNotchIcon className="size-5 animate-spin text-zinc-500" />
        </div>
      ) : photosQuery.isError ? (
        <p className="text-sm text-red-400">{gymListingErrorMessage(photosQuery.error, "Không tải được danh sách ảnh.")}</p>
      ) : (
        <PhotosSection
          copy={{
            intro: (n, max) => `${n}/${max} ảnh. Ảnh bìa hiện trên thẻ chi nhánh khi khách tìm phòng gym.`,
            empty: "Chưa có ảnh nào — tải lên ít nhất một ảnh để khách hình dung được không gian tập luyện.",
            removeLabel: "Xóa ảnh",
            footer: "JPEG, PNG hoặc WebP, tối đa 8 MB mỗi ảnh.",
          }}
          ids={ids}
          cover={cover}
          photos={photoMap}
          spare={[]}
          max={MAX_DRAFT_BRANCH_PHOTOS}
          uploads={uploads}
          busy={busy}
          onAdd={(files) => void onAdd(files)}
          onMove={(id, dir) =>
            void guarded(async () => {
              const next = movePhoto(ids, id, dir);
              if (next === ids) return;
              queryClient.setQueryData(queryKey, await gymListingService.reorderPhotos(gymId, next));
            }, "Không sắp xếp lại được ảnh")
          }
          onSetCover={(id) =>
            void guarded(async () => {
              queryClient.setQueryData(queryKey, await gymListingService.setCover(gymId, id));
            }, "Không đặt được ảnh bìa")
          }
          onRemove={(id) => setDeleteId(id)}
          onDeleteStaged={(id) => setDeleteId(id)}
          onAddExisting={() => {}}
          onRetryUpload={(key) => {
            const entry = uploads.find((u) => u.key === key);
            if (entry) void uploadOne(entry.file, key);
          }}
          onDropUpload={(key) => setUploads((prev) => prev.filter((u) => u.key !== key))}
        />
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Xóa ảnh này?"
        description="Ảnh sẽ bị xóa hẳn khỏi chi nhánh."
        confirmLabel="Xóa ảnh"
        onConfirm={async () => {
          const id = deleteId;
          setDeleteId(null);
          if (!id) return;
          await guarded(async () => {
            await gymListingService.deletePhoto(gymId, id);
            await queryClient.invalidateQueries({ queryKey });
            toast.success("Đã xóa ảnh");
          }, "Không xóa được ảnh");
        }}
      />
    </div>
  );
}
