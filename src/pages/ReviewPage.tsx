// One review: where it is, how far it got, Pause / Resume, and the report
// once it is done. Polls while the review is live and stops when it is
// not, so a paused review left open in a tab costs nothing.

import { useEffect, useState } from "react";
import FileTree from "../FileTree";
import FindingsView from "../FindingsView";
import {
  ApiError,
  getReviewReport,
  getReviewStatus,
  loginUrl,
  type ReportResult,
  type ReportView,
  type ReviewStatus,
} from "../api";
import DeleteReview from "../components/DeleteReview";
import ProgressTrack from "../components/ProgressTrack";
import ReviewControls from "../components/ReviewControls";
import StatusBadge from "../components/StatusBadge";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { duration, exactTime, plural, shortRepo, shortSha, timeAgo } from "../lib/format";
import { groupOf, isLive, overallProgress } from "../lib/status";

const POLL_MS = 2000;
const DEPTH: Record<string, string> = { quick: "Quick", brief: "Brief", deep: "Deep" };

function displayText(report: ReportResult): string {
  return report.view === "markdown" ? report.text : JSON.stringify(report.data, null, 2);
}

/** One plain sentence: what is happening, or what happened. */
function sentence(s: ReviewStatus, done: number | null, total: number | null): string {
  const unit = s.mode === "deep" ? ["file", "files"] : ["part", "parts"];
  const of = done != null && total != null ? `${unit[0]} ${Math.min(done + 1, total)} of ${total}` : null;
  if (s.pausing) return "Pausing. It stops after the file being reviewed now.";
  switch (s.status) {
    case "requested":
      return "Waiting to start.";
    case "cloning":
      return "Copying the repository.";
    case "scanning":
      return "Semgrep, Gitleaks and Trivy are checking the code.";
    case "reviewing":
    case "retrying":
      return of ? `The AI is reviewing ${of}.` : "The AI is reviewing the code.";
    case "paused":
      return done != null && total != null
        ? `Paused ${timeAgo(s.paused_at)} with ${plural(done, unit[0], unit[1])} of ${total} done. Resume continues from there.`
        : `Paused ${timeAgo(s.paused_at)}. Resume continues from where it stopped.`;
    case "interrupted":
      return "Stopped before it finished, most likely because the server restarted. Resume continues from the last finished file.";
    case "failed":
      return "Stopped by an error. Resume continues from the last finished file.";
    case "cancelled":
      return "Cancelled. Resume continues from the last finished file.";
    case "completed":
      return "Finished. The report is below.";
    default:
      return "";
  }
}

function Report({ triggerId, signedIn }: { triggerId: string; signedIn: boolean }) {
  const [report, setReport] = useState<ReportResult | null>(null);
  const [view, setView] = useState<ReportView>("full");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getReviewReport(triggerId, view)
      .then(setReport)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setError(
            signedIn
              ? "There is no report for this review. It may have been deleted."
              : "You are signed out. Reviews started while signed in are only visible to the account that started them.",
          );
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load the report.");
      });
  }, [triggerId, view, signedIn]);

  async function copy() {
    if (!report) return;
    await navigator.clipboard.writeText(displayText(report));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    if (!report) return;
    const ext = report.view === "markdown" ? "md" : "json";
    const url = URL.createObjectURL(new Blob([displayText(report)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${triggerId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel report-panel" aria-labelledby="report-title">
      <div className="panel-head">
        <h2 id="report-title">Report</h2>
        <div className="report-tools">
          <select aria-label="Report view" value={view} onChange={(e) => setView(e.target.value as ReportView)}>
            <option value="full">Findings</option>
            <option value="summary">Summary counts</option>
            <option value="markdown">Markdown text</option>
          </select>
          <button type="button" className="btn btn-quiet" onClick={copy} disabled={!report}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={download} disabled={!report}>
            Download .{report?.view === "markdown" ? "md" : "json"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="inline-error">{error}</p>
      ) : !report ? (
        <p className="quiet">Loading the report…</p>
      ) : report.view === "full" ? (
        <FindingsView data={report.data} />
      ) : (
        <pre className="report-text" style={{ whiteSpace: report.view === "markdown" ? "pre-wrap" : "pre" }}>
          {displayText(report)}
        </pre>
      )}
    </section>
  );
}

export default function ReviewPage({ triggerId }: { triggerId: string }) {
  const { user } = useSession();
  const { go } = useRouter();
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when Pause/Resume changes the state, so polling restarts.
  const [kick, setKick] = useState(0);

  const live = !!status && (isLive(status.status) || !!status.pausing);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const s = await getReviewStatus(triggerId);
        if (cancelled) return;
        setStatus((prev) => ({ ...s, trigger: s.trigger ?? prev?.trigger }));
        if (isLive(s.status) || s.pausing) timer = window.setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setLost(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load this review.");
      }
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [triggerId, kick]);

  function changed(next: ReviewStatus) {
    setStatus((prev) => ({ ...prev, ...next, trigger: next.trigger ?? prev?.trigger }));
    setKick((k) => k + 1);
  }

  const trigger = status?.trigger;
  const repo = trigger?.repo_url ?? status?.repo_url ?? "";
  const mode = trigger?.mode ?? status?.mode ?? "";
  const progress = status ? overallProgress(status) : null;
  const percent = progress?.percent ?? null;
  const showReport = status?.status === "completed" || (lost && !status);

  if (error) {
    return (
      <div className="page">
        <p className="inline-error">{error}</p>
      </div>
    );
  }

  if (lost && !status) {
    return (
      <div className="page">
        <Link href="/history" className="crumb">
          My reviews
        </Link>
        <h1 className="page-title">This review</h1>
        {!user && user !== undefined && (
          <p className="notice">
            You are signed out. If you started this review while signed in,{" "}
            <a href={loginUrl()}>sign in with GitHub</a> to see it.
          </p>
        )}
        <Report triggerId={triggerId} signedIn={!!user} />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="page">
        <p className="quiet">Loading the review…</p>
      </div>
    );
  }

  const group = status.pausing ? "paused" : groupOf(status.status);

  return (
    <div className="page page-review">
      <Link href="/history" className="crumb">
        My reviews
      </Link>
      <header className="review-head">
        <div className="review-title-row">
          <h1 className="page-title review-title">{repo ? shortRepo(repo) : "Review"}</h1>
          <DeleteReview
            triggerId={triggerId}
            repo={repo ? shortRepo(repo) : "this repository"}
            running={live}
            onDeleted={() => go("/history")}
          />
        </div>
        <dl className="facts">
          <div>
            <dt>Branch</dt>
            <dd>{trigger?.branch || status.branch || "default"}</dd>
          </div>
          <div>
            <dt>Depth</dt>
            <dd>{DEPTH[mode] ?? mode}</dd>
          </div>
          {(status.commit || trigger?.commit) && (
            <div>
              <dt>Commit</dt>
              <dd className="mono" title={status.commit ?? trigger?.commit ?? ""}>
                {shortSha(status.commit ?? trigger?.commit)}
              </dd>
            </div>
          )}
          {(status.model || trigger?.model) && (
            <div>
              <dt>Model</dt>
              <dd className="mono">{status.model ?? trigger?.model}</dd>
            </div>
          )}
          {trigger?.created_at && (
            <div>
              <dt>Started</dt>
              <dd title={exactTime(trigger.created_at)}>{timeAgo(trigger.created_at)}</dd>
            </div>
          )}
        </dl>
      </header>

      <section className={`panel status-panel status-${group}`} aria-live="polite">
        <div className="status-top">
          <div className="status-figure">
            <span className="figure-number">{percent != null ? percent : "–"}</span>
            <span className="figure-unit">%</span>
          </div>
          <div className="status-words">
            <StatusBadge status={status.status} pausing={status.pausing} />
            <p className="status-sentence">{sentence({ ...status, mode }, progress?.done ?? null, progress?.total ?? null)}</p>
            {live && status.eta_seconds ? (
              <p className="status-eta">About {duration(status.eta_seconds)} left, going by the files so far.</p>
            ) : null}
          </div>
          <ReviewControls triggerId={triggerId} status={status} mode={mode} onChanged={changed} />
        </div>

        <ProgressTrack status={status.status} percent={percent} pausing={status.pausing} />

        {progress && progress.restored > 0 && live && (
          <p className="note">
            Resumed: {plural(progress.restored, mode === "deep" ? "file" : "part", mode === "deep" ? "files" : "parts")}{" "}
            reviewed before the pause are reused.
          </p>
        )}
        {status.error && group === "terminated" && <p className="inline-error">{status.error}</p>}
        {status.detached && (
          <p className="note">
            The review service restarted while this review was running. It is still running and its result will appear
            here, but it cannot be paused until it finishes.
          </p>
        )}
        {status.source && !live && status.status !== "completed" && (
          <p className="note">The review service restarted since this ran, so this is the last status it recorded.</p>
        )}
      </section>

      {status.status !== "requested" && (
        <section className="panel">
          <FileTree triggerId={triggerId} running={live} />
        </section>
      )}

      {showReport && <Report triggerId={triggerId} signedIn={!!user} />}
    </div>
  );
}
