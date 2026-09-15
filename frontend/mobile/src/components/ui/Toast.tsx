import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, XCircle } from "lucide-react-native";

import { haptics } from "../../lib/haptics";
import { darkColors } from "../../theme/colors";
import { toastDuration } from "../../theme/motion";
import { useWorkspaceAccent } from "../../theme/workspace";

export type ToastTone = "success" | "danger";

type ToastState = { message: string; tone: ToastTone } | null;

type ToastApi = {
  /** Show a toast. Calling again while one is visible replaces it and restarts the timer, which is
   *  what the reference does — a queue would make rapid feedback lag behind the action. */
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toast — the reference's `useToast` (2200ms auto-dismiss, success/danger).
 *
 * The reference returns state for a screen to render itself; here it is a provider so the toast
 * renders ABOVE everything from one place. On web a fixed-position element is enough; in RN a
 * toast rendered inside a screen sits inside that screen's stacking context and would be clipped
 * by a sheet or a header.
 *
 * The timer is cleared on unmount and on every replacement, so a toast can never fire `setState`
 * after its screen is gone.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);

  const show = useCallback(
    (message: string, tone: ToastTone = "success") => {
      clear();
      setToast({ message, tone });
      if (tone === "success") haptics.success();
      else haptics.error();
      timer.current = setTimeout(() => setToast(null), toastDuration);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  const api = useMemo<ToastApi>(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={toast} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast }: { toast: ToastState }) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();

  if (!toast) return null;

  const Icon = toast.tone === "success" ? CheckCircle2 : XCircle;
  const iconColor = toast.tone === "success" ? accent.primary : darkColors.destructive;

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(150)}
      pointerEvents="none"
      // Solid `bg-card`, not the `glass` fill the headers and sheets use: those sit above a known
      // background, whereas a toast lands on top of arbitrary content — and with no
      // backdrop-filter in RN, a translucent fill just lets that content show through and makes
      // the message hard to read. A shadow separates it instead of a blur.
      className="absolute left-4 right-4 z-[100] flex-row items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg shadow-black/50"
      style={{ top: insets.top + 8 }}
      accessibilityLiveRegion="polite"
    >
      <Icon size={18} color={iconColor} />
      <Text className="flex-1 text-sm font-body-medium text-foreground">{toast.message}</Text>
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
