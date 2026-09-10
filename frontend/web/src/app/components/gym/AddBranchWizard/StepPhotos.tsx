import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon, ImageIcon, StarIcon, TrashIcon, CaretLeftIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import { gymService, gymPhotoUrl } from "../../../services/api";
import type { GymPhoto } from "../../../types";

const MAX_PHOTOS = 20;

/** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery — upload/preview/
 * reorder/delete/set-cover, mirroring the API gap doc's expected behavior list exactly.
 * Self-contained (owns its own query/mutations) unlike Steps 1-3, which hand a plain value
 * up to the parent: a photo grid's natural unit of action is "this one photo", not a single
 * debounced form value. */
export function StepPhotos({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryKey = ["gym-photos", gymId];

  const photosQuery = useQuery<GymPhoto[]>({ queryKey, queryFn: () => gymService.listGymPhotos(gymId) });
  const photos = photosQuery.data ?? [];

  const uploadMutation = useMutation({
    mutationFn: (file: File) => gymService.uploadGymPhoto(gymId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tải ảnh lên"),
  });

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) => gymService.deleteGymPhoto(gymId, photoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể xoá ảnh"),
  });

  const coverMutation = useMutation({
    mutationFn: (photoId: string) => gymService.setGymPhotoCover(gymId, photoId),
    onSuccess: (updated) => queryClient.setQueryData(queryKey, updated),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể đặt ảnh bìa"),
  });

  const reorderMutation = useMutation({
    mutationFn: (photoIds: string[]) => gymService.reorderGymPhotos(gymId, photoIds),
    onSuccess: (updated) => queryClient.setQueryData(queryKey, updated),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể sắp xếp lại"),
  });

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast.error(`Tối đa ${MAX_PHOTOS} ảnh cho mỗi chi nhánh`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    for (const file of toUpload) {
      await uploadMutation.mutateAsync(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const ids = photos.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate(ids);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Hình ảnh</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Thư viện ảnh công khai — khách xem được khi tìm phòng gym. Tối đa {MAX_PHOTOS} ảnh, JPG/PNG/WEBP.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending || photos.length >= MAX_PHOTOS}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-zinc-700 text-sm font-semibold text-zinc-400 hover:bg-zinc-900 disabled:opacity-50 transition-colors"
      >
        {uploadMutation.isPending ? <CircleNotchIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
        {uploadMutation.isPending ? "Đang tải ảnh lên..." : "Tải ảnh lên"}
      </button>

      {photosQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <CircleNotchIcon className="size-5 text-zinc-500 animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
          <ImageIcon className="size-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">Chưa có ảnh nào — tải lên ít nhất một ảnh để khách hình dung được không gian tập luyện.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo, index) => (
            <div key={photo.id} className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 group">
              <img src={gymPhotoUrl(photo.fileName)} alt="" className="w-full aspect-square object-cover" />
              {photo.isCover && (
                <span className="absolute top-1.5 left-1.5 flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-black">
                  <StarIcon className="size-3" weight="fill" /> Ảnh bìa
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1.5 bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    aria-label="Di chuyển lên/trái"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="size-6 flex items-center justify-center rounded bg-white/10 text-white disabled:opacity-30 hover:bg-white/20"
                  >
                    <CaretLeftIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Di chuyển xuống/phải"
                    disabled={index === photos.length - 1}
                    onClick={() => move(index, 1)}
                    className="size-6 flex items-center justify-center rounded bg-white/10 text-white disabled:opacity-30 hover:bg-white/20"
                  >
                    <CaretRightIcon className="size-3.5" />
                  </button>
                </div>
                <div className="flex gap-0.5">
                  {!photo.isCover && (
                    <button
                      type="button"
                      aria-label="Đặt làm ảnh bìa"
                      onClick={() => coverMutation.mutate(photo.id)}
                      className="size-6 flex items-center justify-center rounded bg-white/10 text-white hover:bg-white/20"
                    >
                      <StarIcon className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Xoá ảnh"
                    onClick={() => deleteMutation.mutate(photo.id)}
                    className="size-6 flex items-center justify-center rounded bg-white/10 text-red-400 hover:bg-red-500/20"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
