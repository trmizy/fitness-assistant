import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ArrowsClockwiseIcon as RefreshCw, WifiSlashIcon as WifiOff } from "@phosphor-icons/react";
import { shouldRegisterPwa } from "./pwa-registration.utils";

const SERVICE_WORKER_URL = "/sw.js";

function isServiceWorkerReady(worker: ServiceWorker | null): worker is ServiceWorker {
  return Boolean(worker);
}

export function PwaUpdatePrompt() {
  const reloadRequestedRef = useRef(false);
  const offlineReadyShownRef = useRef(false);

  useEffect(() => {
    if (!shouldRegisterPwa(navigator, window, import.meta.env.DEV)) return;

    let disposed = false;

    const promptUpdate = (worker: ServiceWorker | null) => {
      if (!isServiceWorkerReady(worker)) return;

      toast("Có phiên bản mới", {
        description: "Cập nhật để dùng bản mới nhất.",
        icon: <RefreshCw className="h-4 w-4" />,
        duration: Infinity,
        action: {
          label: "Cập nhật",
          onClick: () => {
            reloadRequestedRef.current = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };

    const showOfflineReady = () => {
      if (offlineReadyShownRef.current) return;
      offlineReadyShownRef.current = true;
      toast("Có thể mở khi mất mạng", {
        description: "Một bản shell cơ bản đã sẵn sàng cho lần tải lại offline.",
        icon: <WifiOff className="h-4 w-4" />,
        duration: 5000,
      });
    };

    const onControllerChange = () => {
      if (!reloadRequestedRef.current || disposed) return;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL)
      .then((registration) => {
        if (disposed) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          promptUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (disposed || installing.state !== "installed") return;

            if (navigator.serviceWorker.controller) {
              promptUpdate(installing);
            } else {
              showOfflineReady();
            }
          });
        });
      })
      .catch(() => {
        // PWA support must never block the app. The browser may reject
        // registration in private mode, unsupported shells, or unusual origins.
      });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}

