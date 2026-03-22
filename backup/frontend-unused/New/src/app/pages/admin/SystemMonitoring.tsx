import { AreaChart, Area, BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Monitor, Activity, Server, Cpu, HardDrive, Wifi, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";

const requestVolume = [
  { time: "00:00", req: 120 }, { time: "03:00", req: 45 }, { time: "06:00", req: 230 },
  { time: "09:00", req: 890 }, { time: "12:00", req: 1240 }, { time: "15:00", req: 1100 },
  { time: "18:00", req: 780 }, { time: "21:00", req: 420 }, { time: "Now", req: 650 },
];

const ocrQueue = [
  { hour: "8am", queued: 12, done: 10, failed: 2 }, { hour: "9am", queued: 25, done: 23, failed: 2 },
  { hour: "10am", queued: 18, done: 17, failed: 1 }, { hour: "11am", queued: 32, done: 29, failed: 3 },
  { hour: "12pm", queued: 28, done: 26, failed: 2 }, { hour: "1pm", queued: 15, done: 14, failed: 1 },
];

const serviceHealth = [
  { time: "12:00", api: 99, ocr: 97, db: 100, ws: 98 },
  { time: "13:00", api: 98, ocr: 95, db: 100, ws: 99 },
  { time: "14:00", api: 100, ocr: 99, db: 100, ws: 100 },
  { time: "15:00", api: 97, ocr: 96, db: 99, ws: 98 },
  { time: "16:00", api: 99, ocr: 98, db: 100, ws: 99 },
  { time: "17:00", api: 100, ocr: 99, db: 100, ws: 100 },
];

const services = [
  { name: "API Server", status: "healthy", latency: "42ms", uptime: "99.98%", icon: Server },
  { name: "OCR Service", status: "healthy", latency: "1.2s", uptime: "99.2%", icon: Cpu },
  { name: "Database", status: "healthy", latency: "8ms", uptime: "100%", icon: HardDrive },
  { name: "WebSocket", status: "healthy", latency: "15ms", uptime: "99.7%", icon: Wifi },
  { name: "Queue Worker", status: "degraded", latency: "—", uptime: "94.2%", icon: RefreshCw },
];

const recentErrors = [
  { service: "OCR", message: "Image parsing timeout after 30s", time: "14:32", level: "warning" },
  { service: "API", message: "Rate limit exceeded — user id:4821", time: "13:55", level: "info" },
  { service: "Queue", message: "Worker restart — memory limit reached", time: "12:18", level: "error" },
  { service: "OCR", message: "Low confidence extraction — manual review triggered", time: "11:44", level: "warning" },
];

export function SystemMonitoring() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-gray-900 flex items-center gap-2"><Monitor className="w-5 h-5 text-violet-600" /> System Monitoring</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time platform health and service status</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> Live
          </span>
          <span className="text-xs text-gray-400">Updated just now</span>
        </div>
      </div>

      {/* Service status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {services.map(s => (
          <div key={s.name} className={`bg-white rounded-xl shadow-sm border p-3 ${s.status === "healthy" ? "border-gray-100" : "border-amber-200 bg-amber-50/30"}`}>
            <div className="flex items-center justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.status === "healthy" ? "bg-green-100" : "bg-amber-100"}`}>
                <s.icon className={`w-4 h-4 ${s.status === "healthy" ? "text-green-600" : "text-amber-600"}`} />
              </div>
              <span className={`flex items-center gap-1 text-xs font-semibold ${s.status === "healthy" ? "text-green-600" : "text-amber-600"}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${s.status === "healthy" ? "bg-green-500" : "bg-amber-500"}`} />
                {s.status === "healthy" ? "OK" : "Degraded"}
              </span>
            </div>
            <div className="text-xs font-semibold text-gray-900">{s.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">Latency: {s.latency}</div>
            <div className="text-xs text-gray-400">Uptime: {s.uptime}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Request volume */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-600" />
            <h4 className="text-sm font-semibold text-gray-900">API Request Volume (Today)</h4>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={requestVolume}>
              <defs>
                <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [`${v} req/min`]} />
              <Area type="monotone" dataKey="req" stroke="#3b82f6" fill="url(#rg)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* OCR queue */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">OCR Queue Status</h4>
            <span className="text-xs text-gray-500">Success rate: 94.2%</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={ocrQueue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="done"   fill="#22c55e" radius={[3, 3, 0, 0]} name="Success" />
              <Bar dataKey="failed" fill="#f87171" radius={[3, 3, 0, 0]} name="Failed"  />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Service health trends */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Service Uptime % (Last 6 hours)</h4>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={serviceHealth}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[90, 100]} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number) => [`${v}%`]} />
            <Line type="monotone" dataKey="api" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="API" />
            <Line type="monotone" dataKey="ocr" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="OCR" />
            <Line type="monotone" dataKey="db" stroke="#22c55e" strokeWidth={1.5} dot={false} name="DB" />
            <Line type="monotone" dataKey="ws" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="WS" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2 text-xs">
          {[{ label: "API", color: "#3b82f6" }, { label: "OCR", color: "#f59e0b" }, { label: "DB", color: "#22c55e" }, { label: "WS", color: "#8b5cf6" }].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: l.color }} />
              <span className="text-gray-500">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Error log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-gray-900">Recent Error Log</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5">Level</th>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Message</th>
                <th className="px-4 py-2.5">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentErrors.map((e, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${e.level === "error" ? "bg-red-100 text-red-600" : e.level === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-600"}`}>
                      {e.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">{e.service}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{e.message}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{e.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}