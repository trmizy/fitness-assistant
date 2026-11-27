import { useSettings } from "../../context/SettingsContext";

type AppLogoProps = {
  className?: string;
  imgClassName?: string;
};

// Batch 0a — the 1254px PNGs (1.14 MB / 945 KB) were drawn at 112px at most (login, h-28).
// 384px WebP covers DPR 3 at that size. NEW file names on purpose: /brand/* is served
// `immutable, max-age=1y` on an unhashed path, so overwriting the PNG in place would leave
// returning visitors on the old bytes. The PNGs stay in public/ for anything external.
const LOGO_BY_THEME = {
  dark: "/brand/gymini-logo-dark-384.webp",
  light: "/brand/gymini-logo-light-384.webp",
} as const;

export function getAppLogoSrc(theme: "dark" | "light") {
  return LOGO_BY_THEME[theme];
}

export function AppLogo({ className = "", imgClassName = "" }: AppLogoProps) {
  const { effectiveTheme } = useSettings();

  return (
    <div className={`flex items-center ${className}`}>
      <img
        src={getAppLogoSrc(effectiveTheme)}
        alt="Gymini"
        width={384}
        height={384}
        decoding="async"
        className={`block object-contain ${imgClassName}`}
        draggable={false}
      />
    </div>
  );
}
