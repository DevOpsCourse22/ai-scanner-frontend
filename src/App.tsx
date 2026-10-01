import { useEffect } from "react";
import { loginUrl } from "./api";
import Logo from "./components/Logo";
import { ToastProvider } from "./components/Toasts";
import History from "./pages/History";
import Home from "./pages/Home";
import ReviewPage from "./pages/ReviewPage";
import Settings from "./pages/Settings";
import { Link, RouterProvider, useRouter } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import "./App.css";
import "./report.css";

const TITLES = { home: "New review", history: "My reviews", review: "Review", settings: "Settings", "not-found": "Not found" };

function TopBar() {
  const { route } = useRouter();
  const { user } = useSession();
  const nav = [
    { href: "/", label: "New review", on: route.page === "home" },
    { href: "/history", label: "My reviews", on: route.page === "history" || route.page === "review" },
    { href: "/settings", label: "Settings", on: route.page === "settings" },
  ];
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="AI Scan Repos, new review">
        <Logo />
        <span className="brand-name">AI Scan Repos</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={`nav-link${n.on ? " is-on" : ""}`} aria-current={n.on ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="who">
        {user ? (
          <Link href="/settings" className="who-link" title={`Signed in as ${user.login}`}>
            {user.avatar_url && <img className="avatar" src={user.avatar_url} alt="" width={30} height={30} />}
            <span className="who-name">{user.login}</span>
          </Link>
        ) : user === null ? (
          <a className="btn btn-quiet btn-small" href={loginUrl()}>
            Sign in with GitHub
          </a>
        ) : null}
      </div>
    </header>
  );
}

function Page() {
  const { route } = useRouter();

  useEffect(() => {
    document.title = `${TITLES[route.page]} · AI Scan Repos`;
  }, [route.page]);

  // key: each page starts fresh and plays its entrance once.
  switch (route.page) {
    case "home":
      return <Home key="home" />;
    case "history":
      return <History key="history" />;
    case "settings":
      return <Settings key="settings" />;
    case "review":
      return <ReviewPage key={route.triggerId} triggerId={route.triggerId} />;
    default:
      return (
        <div className="page">
          <h1 className="page-title">This page does not exist</h1>
          <p className="quiet">
            Go to <Link href="/">New review</Link> or <Link href="/history">My reviews</Link>.
          </p>
        </div>
      );
  }
}

export default function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <ToastProvider>
          <div className="app">
            <a className="skip" href="#main">
              Skip to content
            </a>
            <TopBar />
            <main id="main" className="main">
              <Page />
            </main>
          </div>
        </ToastProvider>
      </SessionProvider>
    </RouterProvider>
  );
}
