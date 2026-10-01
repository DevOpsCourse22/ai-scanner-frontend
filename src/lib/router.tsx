// A router small enough to read in one sitting: four pages do not need a
// dependency. Paths are real URLs (history.pushState), so a review page
// can be bookmarked and reopened days later.
//
// Page paths must not start with a gateway prefix (/auth, /reviews,
// /providers, /webhook, /health): the Ingress sends those to the gateway,
// not to this app. That is why a single review lives at /review/<id>,
// singular, and the list at /history.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Route =
  | { page: "home" }
  | { page: "history" }
  | { page: "review"; triggerId: string }
  | { page: "settings" }
  | { page: "not-found" };

export function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { page: "home" };
  if (path === "/history") return { page: "history" };
  if (path === "/settings") return { page: "settings" };
  const review = path.match(/^\/review\/([A-Za-z0-9-]{1,64})$/);
  if (review) return { page: "review", triggerId: review[1] };
  return { page: "not-found" };
}

export function hrefFor(route: Route): string {
  switch (route.page) {
    case "home":
      return "/";
    case "history":
      return "/history";
    case "settings":
      return "/settings";
    case "review":
      return `/review/${route.triggerId}`;
    default:
      return "/";
  }
}

const RouterContext = createContext<{ route: Route; go: (href: string) => void }>({
  route: { page: "home" },
  go: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(href: string) {
    if (href === window.location.pathname) return;
    window.history.pushState(null, "", href);
    setRoute(parse(href));
    window.scrollTo({ top: 0 });
  }

  return <RouterContext.Provider value={{ route, go }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  return useContext(RouterContext);
}

/** An <a> that navigates without a page reload, and still opens in a new
 *  tab on ctrl/cmd/middle click like any link. */
export function Link({
  href,
  className,
  children,
  ...rest
}: { href: string; className?: string; children: ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  const { go } = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        go(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
