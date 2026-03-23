import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search, ChevronRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { chatService } from "../../services/api";

function safeText(value: unknown, fallback = "-") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const maybeMsg = (value as any).message;
    if (typeof maybeMsg === "string") return maybeMsg;
    return fallback;
  }
  return fallback;
}

export function PTClientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["pt-client-list-conversations"],
    queryFn: chatService.listConversations,
  });

  const clients = useMemo(() => {
    const conversations = data?.conversations || [];
    return conversations
      .map((conv: any) => ({
        id: conv.otherUser?.id,
        name: `${conv.otherUser?.firstName || ""} ${conv.otherUser?.lastName || ""}`.trim() || "Unknown",
        email: safeText(conv.otherUser?.email, ""),
        role: safeText(conv.otherUser?.role, "CLIENT"),
        avatar: `${conv.otherUser?.firstName?.[0] || "U"}${conv.otherUser?.lastName?.[0] || ""}`,
        lastMessage: safeText(conv.lastMessage?.content, "No messages yet"),
      }))
      .filter((c: any) => !!c.id && c.role !== "PT");
  }, [data]);

  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(search.toLowerCase()) || client.email.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">My Clients</h1>
        <p className="text-zinc-500 text-sm mt-0.5">{clients.length} active coaching relationships</p>
      </div>

      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5">
        <Search className="w-4 h-4 text-zinc-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..." className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600" />
      </div>

      <div className="hidden md:block bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
              <th className="px-4 py-3">Client</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Last Message</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map(c => (
              <tr key={c.id} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors cursor-pointer" onClick={() => navigate(`/pt/clients/${c.id}`)}>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">{c.avatar}</div><span className="text-sm font-semibold text-zinc-200">{c.name}</span></div></td>
                <td className="px-4 py-3 text-sm text-zinc-400">{c.email || "-"}</td>
                <td className="px-4 py-3 text-sm text-zinc-500 max-w-[360px] truncate">{c.lastMessage}</td>
                <td className="px-4 py-3"><ChevronRight className="w-4 h-4 text-zinc-600" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredClients.length === 0 && <div className="p-6 text-sm text-zinc-500 border border-zinc-800/50 rounded-xl">Chua co du lieu client tu database.</div>}
    </div>
  );
}
