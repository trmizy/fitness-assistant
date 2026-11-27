import { useNavigate } from "react-router";

/**
 * A plain anchor that navigates through the router (the Sidebar and TodayPage use the same approach: react-router's own Link
 * has the duplicate @types/react typing error in this tree). Modified clicks fall through to the browser (new tab etc.).
 */
export function GoLink({ to, children, onNavigate, ...rest }: { to: string; children: React.ReactNode; onNavigate?: () => void } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const navigate = useNavigate();
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
