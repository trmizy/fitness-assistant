import { isRouteErrorResponse, Link, useRouteError } from "react-router";

function toSafeMessage(error: unknown): string {
  if (error == null) return "Lỗi không xác định";
  if (typeof error === "string") return error;
  if (error instanceof Error && typeof error.message === "string")
    return error.message;
  if (typeof error === "object") {
    const maybeMessage = (error as any)?.message;
    if (typeof maybeMessage === "string") return maybeMessage;
    const maybeError = (error as any)?.error;
    if (typeof maybeError === "string") return maybeError;
    if (
      maybeError &&
      typeof maybeError === "object" &&
      typeof maybeError.message === "string"
    ) {
      return maybeError.message;
    }
  }
  return "Đã xảy ra lỗi không mong muốn";
}

export function RouteErrorBoundary() {
  const error = useRouteError();

  // Đường dẫn không tồn tại: trang thân thiện, không lộ thông báo kỹ thuật của router.
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-zinc-800/60 bg-zinc-900 p-8 text-center">
          <div className="text-green-400 text-5xl font-bold mb-3">404</div>
          <h2 className="text-zinc-100 text-lg font-bold mb-2">Không tìm thấy trang</h2>
          <p className="text-zinc-500 text-sm leading-relaxed mb-6">
            Đường dẫn bạn mở không tồn tại hoặc đã được chuyển đi nơi khác.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-green-500 hover:bg-green-400 text-black text-sm font-bold transition-colors"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  let title = "Đã xảy ra lỗi";
  let detail = toSafeMessage(error);

  if (isRouteErrorResponse(error)) {
    title = `Lỗi ${error.status}`.trim();
    detail = toSafeMessage(error.data) || detail;
  }

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-xl border border-red-500/20 bg-red-500/5 p-5">
        <h2 className="text-red-300 text-lg font-bold mb-2">{title}</h2>
        <p className="text-red-200/90 text-sm leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
