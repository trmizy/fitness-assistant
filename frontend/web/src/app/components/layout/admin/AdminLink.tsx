import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useHref, useLinkClickHandler } from "react-router";

type AdminLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  replace?: boolean;
};

/**
 * A real `<a href>` that navigates client-side — built on react-router's own `useHref` +
 * `useLinkClickHandler` (modified clicks / middle-click / "open in new tab" behave natively).
 * Used by the admin shell instead of `<Link>`/`<NavLink>` so the active state is computed in
 * one place (`adminNav.ts`), not re-derived by the router.
 */
export const AdminLink = forwardRef<HTMLAnchorElement, AdminLinkProps>(function AdminLink(
  { to, replace, onClick, target, ...rest },
  ref,
) {
  const href = useHref(to);
  const handleClick = useLinkClickHandler<HTMLAnchorElement>(to, { replace, target });
  return (
    <a
      {...rest}
      ref={ref}
      href={href}
      target={target}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) handleClick(event);
      }}
    />
  );
});
