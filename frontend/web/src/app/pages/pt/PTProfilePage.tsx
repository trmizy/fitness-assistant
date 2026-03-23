import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { profileService } from "../../services/api";

export function PTProfilePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["pt-profile"],
    queryFn: profileService.getProfile,
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 text-xl font-bold">PT Profile</h1>
        <p className="text-zinc-500 text-sm mt-1">Using real profile data from database.</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <UserRound className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-zinc-200">Profile</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : !data ? (
          <p className="text-sm text-zinc-500">No profile data found.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-zinc-300"><span className="text-zinc-500">Age:</span> {data.age ?? "-"}</p>
            <p className="text-zinc-300"><span className="text-zinc-500">Height:</span> {data.heightCm ?? "-"} cm</p>
            <p className="text-zinc-300"><span className="text-zinc-500">Weight:</span> {data.weightKg ?? "-"} kg</p>
            <p className="text-zinc-300"><span className="text-zinc-500">Goal:</span> {data.goal || "-"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
