import type { ElementType, ReactNode } from "react";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import type { AppLanguage } from "../../context/SettingsContext";

type AutoTextProps = {
  children: string;
  sourceLang?: AppLanguage;
  as?: ElementType;
  className?: string;
  title?: string;
};

export function AutoText({
  children,
  sourceLang = "vi",
  as,
  className,
  title,
}: AutoTextProps) {
  const Component = as || "span";
  const { text } = useAutoTranslate(children, sourceLang);

  return (
    <Component className={className} title={title}>
      {text as ReactNode}
    </Component>
  );
}
