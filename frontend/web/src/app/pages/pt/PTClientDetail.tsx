import { useParams } from "react-router";
import { UserRound } from "lucide-react";

export function PTClientDetail() {
  const { id } = useParams();

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 text-xl font-bold">Client Detail</h1>
        <p className="text-zinc-500 text-sm mt-1">Client ID: {id}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-8 text-center">
        <UserRound className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
        <p className="text-zinc-300 font-semibold">No detailed PT-client endpoint connected</p>
        <p className="text-zinc-500 text-sm mt-1">Hardcoded progress and body-composition sample data were removed.</p>
      </div>
    </div>
  );
}
