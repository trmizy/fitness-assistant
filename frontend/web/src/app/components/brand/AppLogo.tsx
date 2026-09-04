import { useSettings } from "../../context/SettingsContext";

type AppLogoProps = {
  className?: string;
  imgClassName?: string;
};

const LOGO_BY_THEME = {
  dark: "/brand/gymini-logo-dark.png",
  light: "/brand/gymini-logo-light.png",
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
        className={`block object-contain ${imgClassName}`}
        draggable={false}
      />
    </div>
  );
}
