// One review in a list: what it is, where it got to, and - when it is
// waiting on the person - the button that continues it.

import type { MyReview, ReviewStatus } from "../api";
import { Link } from "../lib/router";
import { exactTime, shortRepo, timeAgo } from "../lib/format";
import { groupOf } from "../lib/status";
import DeleteReview from "./DeleteReview";
import ProgressTrack from "./ProgressTrack";
import ReviewControls from "./ReviewControls";
import StatusBadge from "./StatusBadge";

const DEPTH: Record<string, string> = { quick: "Quick", brief: "Brief", deep: "Deep" };

/** The one time worth showing for this row, said the way a person would. */
function when(r: MyReview): { text: string; iso: string | null | undefined } {
  const group = groupOf(r.status);
  if (group === "paused") return { text: `Paused ${timeAgo(r.paused_at ?? r.status_updated_at)}`, iso: r.paused_at };
  if (group === "completed") return { text: `Finished ${timeAgo(r.finished_at ?? r.status_updated_at)}`, iso: r.finished_at };
  if (group === "terminated") return { text: `Stopped ${timeAgo(r.finished_at ?? r.status_updated_at)}`, iso: r.finished_at };
  return { text: `Started ${timeAgo(r.created_at)}`, iso: r.created_at };
}

export default function ReviewRow({
  review,
  onChanged,
  onDeleted,
}: {
  review: MyReview;
  onChanged: (triggerId: string, next: ReviewStatus) => void;
  /** Offer Delete on the row (My reviews), and drop the row after it. */
  onDeleted?: (triggerId: string) => void;
}) {
  const status = review.status ?? "requested";
  const t = when(review);
  const resumable = ["paused", "failed", "cancelled", "interrupted"].includes(status);

  return (
    <li className={`row row-${groupOf(status)}`}>
      <div className="row-status">
        <StatusBadge status={status} />
      </div>
      <div className="row-main">
        <Link href={`/review/${review.trigger_id}`} className="row-repo">
          {shortRepo(review.repo_url)}
        </Link>
        <div className="row-meta">
          <span className="chip">{DEPTH[review.mode] ?? review.mode}</span>
          <span className="row-branch">{review.branch || "default branch"}</span>
          <time dateTime={t.iso ?? undefined} title={exactTime(t.iso)}>
            {t.text}
          </time>
        </div>
        {groupOf(status) === "terminated" && review.error && <p className="row-error">{review.error}</p>}
      </div>
      <div className="row-progress">
        <ProgressTrack status={status} percent={review.percent ?? null} compact />
        <span className="row-percent">{review.percent != null ? `${review.percent}%` : ""}</span>
      </div>
      <div className="row-action">
        {resumable ? (
          <ReviewControls
            compact
            triggerId={review.trigger_id}
            mode={review.mode}
            status={{ status, resumable: true }}
            onChanged={(next) => onChanged(review.trigger_id, next)}
          />
        ) : (
          <Link href={`/review/${review.trigger_id}`} className="btn btn-quiet">
            {status === "completed" ? "Open report" : "Open"}
          </Link>
        )}
        {onDeleted && (
          <DeleteReview
            compact
            triggerId={review.trigger_id}
            repo={shortRepo(review.repo_url)}
            running={groupOf(status) === "running"}
            onDeleted={() => onDeleted(review.trigger_id)}
          />
        )}
      </div>
    </li>
  );
}
