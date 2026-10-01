// Every review this GitHub account started, grouped the way the person
// thinks about them: running, paused, terminated, completed. The list
// comes from the gateway's database, so it is the same on any computer
// and after any restart.

import { useEffect, useMemo, useState } from "react";
import { getMyReviews, loginUrl, type MyReview, type ReviewStatus } from "../api";
import ReviewRow from "../components/ReviewRow";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { GROUP_LABEL, groupOf, type Group } from "../lib/status";

type Filter = "all" | Group;
const FILTERS: Filter[] = ["all", "running", "paused", "terminated", "completed"];
const FILTER_KEY = "aiscan.history.filter";

const EMPTY: Record<Filter, string> = {
  all: "You have not started a review yet.",
  running: "Nothing is running right now.",
  paused: "No paused reviews. Pause a running review to continue it later.",
  terminated: "No reviews were stopped by an error or a restart.",
  completed: "No finished reviews yet.",
};

function readFilter(): Filter {
  try {
    const v = window.localStorage.getItem(FILTER_KEY) as Filter | null;
    return v && FILTERS.includes(v) ? v : "all";
  } catch {
    return "all";
  }
}

export default function History() {
  const { user } = useSession();
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<Filter>(readFilter);

  function setFilter(f: Filter) {
    setFilterState(f);
    try {
      window.localStorage.setItem(FILTER_KEY, f);
    } catch {
      // not remembered; harmless
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const rows = await getMyReviews();
        if (cancelled) return;
        setReviews(rows);
        if (rows.some((r) => groupOf(r.status) === "running")) timer = window.setTimeout(load, 10000);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your reviews.");
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [user]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, running: 0, paused: 0, terminated: 0, completed: 0 };
    for (const r of reviews ?? []) {
      c.all += 1;
      c[groupOf(r.status)] += 1;
    }
    return c;
  }, [reviews]);

  const shown = (reviews ?? []).filter((r) => filter === "all" || groupOf(r.status) === filter);

  function changed(triggerId: string, next: ReviewStatus) {
    setReviews(
      (rows) =>
        rows &&
        rows.map((r) => (r.trigger_id === triggerId ? { ...r, ...(next.trigger ?? {}), status: next.status } : r)),
    );
  }

  if (user === null) {
    return (
      <div className="page">
        <h1 className="page-title">My reviews</h1>
        <section className="signin-card">
          <h2>Sign in to see your reviews</h2>
          <p>Reviews are saved to your GitHub account, so they are here on any computer, paused ones included.</p>
          <a className="btn btn-primary" href={loginUrl()}>
            Sign in with GitHub
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">My reviews</h1>
        <Link href="/" className="btn btn-quiet">
          New review
        </Link>
      </div>

      <div className="tabs" role="tablist" aria-label="Show reviews">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`tab tab-${f}${filter === f ? " is-on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : GROUP_LABEL[f]}
            <span className="tab-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="inline-error">{error}</p>
      ) : !reviews ? (
        <p className="quiet">Loading your reviews…</p>
      ) : shown.length === 0 ? (
        <p className="empty">{EMPTY[filter]}</p>
      ) : (
        <ul className="rows" key={filter}>
          {shown.map((r) => (
            <ReviewRow
              key={r.trigger_id}
              review={r}
              onChanged={changed}
              onDeleted={(id) => setReviews((rows) => (rows ?? []).filter((x) => x.trigger_id !== id))}
            />
          ))}
        </ul>
      )}

      <p className="footnote">
        Reviews started from a GitHub webhook or while signed out are not listed here, because nobody was signed in to
        own them.
      </p>
    </div>
  );
}
