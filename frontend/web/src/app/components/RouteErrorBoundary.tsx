import { isRouteErrorResponse, useRouteError } from "react-router";

function toSafeMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error && typeof error.message === "string") return error.message;
  if (typeof error === "object") {
    const maybeMessage = (error as any)?.message;
    if (typeof maybeMessage === "string") return maybeMessage;
    const maybeError = (error as any)?.error;
    if (typeof maybeError === "string") return maybeError;
    if (maybeError && typeof maybeError === "object" && typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }
  return "An unexpected error occurred";
}

export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = "Unexpected error";
  let detail = toSafeMessage(error);

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`.trim();
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
