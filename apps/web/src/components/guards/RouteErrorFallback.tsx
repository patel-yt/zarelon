import { isRouteErrorResponse, useRouteError } from "react-router-dom";

export const RouteErrorFallback = () => {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
    ? error.message
    : "Unexpected error";

  return (
    <div className="mx-auto mt-16 max-w-2xl rounded-xl border border-rose-400/30 bg-rose-500/10 p-6">
      <p className="text-xs uppercase tracking-[0.25em] text-rose-200">Application Error</p>
      <p className="mt-2 text-sm text-rose-100">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 rounded-md border border-white/20 px-3 py-2 text-xs text-white/90"
      >
        Reload page
      </button>
    </div>
  );
};
