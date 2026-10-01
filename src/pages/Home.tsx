// The front page: start a review, and see at a glance what is running and
// what is waiting on you.

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getMyReviews,
  loginUrl,
  startReview,
  type Depth,
  type MyReview,
  type ReviewStatus,
} from "../api";
import ReviewRow from "../components/ReviewRow";
import Segmented from "../components/Segmented";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { groupOf } from "../lib/status";

// Mirrors the gateway's Field(max_length=...) caps: a nicety that stops
// typing before it gets pointless. The gateway enforces them regardless.
const REPO_URL_MAX_LENGTH = 512;
const BRANCH_MAX_LENGTH = 255;

function StartForm({ signedIn }: { signedIn: boolean }) {
  const { settings } = useSession();
  const { go } = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState(settings.default_branch);
  const [mode, setMode] = useState<Depth>(settings.default_mode);
  const [findingsFile, setFindingsFile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings load after the first paint; follow them until the person
  // has typed something of their own.
  useEffect(() => setMode(settings.default_mode), [settings.default_mode]);
  useEffect(() => setBranch(settings.default_branch), [settings.default_branch]);

  const deepLocked = mode === "deep" && !signedIn;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (deepLocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await startReview({
        repo_url: repoUrl.trim(),
        branch: branch.trim() || undefined,
        mode,
        findings_file: findingsFile.trim() || undefined,
      });
      go(`/review/${created.trigger_id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          "Another review is running. One review runs at a time, so start this one when it finishes, or pause the running one from My reviews.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not start the review.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="start" onSubmit={submit}>
      <label htmlFor="repo_url" className="visually-hidden">
        Repository URL
      </label>
      <div className="start-bar">
        <input
          id="repo_url"
          className="start-input"
          type="url"
          required
          autoComplete="url"
          maxLength={REPO_URL_MAX_LENGTH}
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-large" disabled={submitting || deepLocked}>
          {submitting ? "Starting…" : "Start review"}
        </button>
      </div>

      <div className="start-options">
        <div className="field field-branch">
          <label htmlFor="branch">Branch</label>
          <input
            id="branch"
            type="text"
            maxLength={BRANCH_MAX_LENGTH}
            placeholder="default branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </div>
        <div className="field field-depth">
          <span className="field-label" id="depth-label">
            Depth
          </span>
          <Segmented<Depth>
            name="mode"
            legend="Depth"
            value={mode}
            onChange={setMode}
            options={[
              { value: "quick", label: "Quick", hint: "A first look, in minutes" },
              { value: "brief", label: "Brief", hint: "The whole repository in one pass" },
              { value: "deep", label: "Deep", hint: "Every file in detail. Can take hours" },
            ]}
          />
        </div>
      </div>

      {deepLocked && (
        <p className="notice">
          Deep reviews need you to <a href={loginUrl()}>sign in with GitHub</a>, so we can check you have access to
          the repository.
        </p>
      )}

      <details className="more">
        <summary>More options</summary>
        <div className="more-body">
          <p className="hint">
            The AI model is chosen for the whole site in <Link href="/settings">Settings</Link>.
          </p>
          <div className="field">
            <label htmlFor="findings_file">Existing findings file on the server</label>
            <input
              id="findings_file"
              type="text"
              maxLength={255}
              placeholder="e.g. EVOTE.findings.json"
              value={findingsFile}
              onChange={(e) => setFindingsFile(e.target.value)}
            />
            <span className="hint">
              Usually empty: Semgrep, Gitleaks and Trivy run on every review. Only for findings someone already
              placed on the server.
            </span>
          </div>
        </div>
      </details>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Overview() {
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const rows = await getMyReviews();
        if (cancelled) return;
        setReviews(rows);
        // Keep live rows moving without a reload, slowly: the review page
        // is where the second-by-second view lives.
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
  }, []);

  const sections = useMemo(() => {
    const rows = reviews ?? [];
    return {
      waiting: rows.filter((r) => ["paused", "terminated"].includes(groupOf(r.status))).slice(0, 4),
      running: rows.filter((r) => groupOf(r.status) === "running"),
      recent: rows.filter((r) => groupOf(r.status) === "completed").slice(0, 4),
    };
  }, [reviews]);

  function changed(triggerId: string, next: ReviewStatus) {
    setReviews((rows) => rows && rows.map((r) => (r.trigger_id === triggerId ? { ...r, ...(next.trigger ?? {}), status: next.status } : r)));
  }

  if (error) return <p className="inline-error">{error}</p>;
  if (!reviews) return <p className="quiet">Loading your reviews…</p>;
  if (reviews.length === 0) {
    return (
      <section className="overview">
        <p className="empty">Your reviews will be listed here. Start one above.</p>
      </section>
    );
  }

  return (
    <div className="overview">
      {sections.running.length > 0 && (
        <section>
          <h2 className="section-title">Running now</h2>
          <ul className="rows">
            {sections.running.map((r) => (
              <ReviewRow key={r.trigger_id} review={r} onChanged={changed} />
            ))}
          </ul>
        </section>
      )}
      {sections.waiting.length > 0 && (
        <section>
          <h2 className="section-title">Waiting for you</h2>
          <p className="section-sub">Paused or stopped reviews. Resume continues from where each one stopped.</p>
          <ul className="rows">
            {sections.waiting.map((r) => (
              <ReviewRow key={r.trigger_id} review={r} onChanged={changed} />
            ))}
          </ul>
        </section>
      )}
      {sections.recent.length > 0 && (
        <section>
          <h2 className="section-title">Recently finished</h2>
          <ul className="rows">
            {sections.recent.map((r) => (
              <ReviewRow key={r.trigger_id} review={r} onChanged={changed} />
            ))}
          </ul>
        </section>
      )}
      <Link href="/history" className="btn btn-link">
        See all your reviews
      </Link>
    </div>
  );
}

export default function Home() {
  const { user } = useSession();
  return (
    <div className="page page-home">
      <header className="hero">
        <h1 className="hero-title">
          <span className="hero-mark">Review a GitHub repository</span>
        </h1>
        <p className="hero-lede">
          Semgrep, Gitleaks and Trivy check the code first. Then an AI model reads it and explains what to fix, and
          why.
        </p>
      </header>

      <StartForm signedIn={!!user} />

      {user ? (
        <Overview />
      ) : user === null ? (
        <section className="signin-card">
          <h2>Keep your reviews between visits</h2>
          <p>
            Sign in with GitHub and every review you start is saved to your account. You can pause a long review today
            and resume it from any computer days later, and deep reviews of your private repositories become available.
          </p>
          <a className="btn btn-primary" href={loginUrl()}>
            Sign in with GitHub
          </a>
        </section>
      ) : null}
    </div>
  );
}
