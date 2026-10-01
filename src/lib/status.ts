// What a review's status means to a person: which group it belongs to on
// the history page, what to call it, and where it is on the progress track.

import type { ReviewStatus } from "../api";

export type Group = "running" | "paused" | "terminated" | "completed";

const LIVE = new Set(["requested", "cloning", "scanning", "reviewing", "retrying"]);

export function isLive(status: string | null | undefined): boolean {
  return LIVE.has(status ?? "");
}

export function groupOf(status: string | null | undefined): Group {
  if (status === "completed") return "completed";
  if (status === "paused") return "paused";
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "terminated";
  return "running";
}

export const GROUP_LABEL: Record<Group, string> = {
  running: "Running",
  paused: "Paused",
  terminated: "Terminated",
  completed: "Completed",
};

/** The word on a badge. "Terminated" is the group; the badge says how. */
export function statusLabel(status: string | null | undefined, pausing = false): string {
  if (pausing) return "Pausing";
  switch (status) {
    case "requested":
      return "Queued";
    case "cloning":
      return "Cloning";
    case "scanning":
      return "Scanning";
    case "reviewing":
      return "Reviewing";
    case "retrying":
      return "Retrying";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    default:
      return "Unknown";
  }
}

/** The four stations of the progress track, in order. */
export const STAGES = ["Clone", "Scan", "AI review", "Report"] as const;

/** Which station a status is at (0-3), and 4 once the report is ready. */
export function stageOf(status: string | null | undefined, percent: number | null): number {
  switch (status) {
    case "requested":
    case "cloning":
      return 0;
    case "scanning":
      return 1;
    case "reviewing":
    case "retrying":
      return 2;
    case "completed":
      return 4;
    default:
      // Paused, failed, interrupted: if any review work was done it had got
      // as far as the AI review; otherwise it stopped before it.
      return percent && percent > 0 ? 2 : 0;
  }
}

/** Progress against the WHOLE review. After a resume review-api counts
 *  only what is left (done/total) plus what the checkpoint gave back
 *  (restored_units); shown as-is, a 64%-done review would read 0% right
 *  after resuming - exactly when someone might give up on it. */
export function overallProgress(s: ReviewStatus): {
  percent: number | null;
  done: number | null;
  total: number | null;
  restored: number;
} {
  const restored = s.restored_units ?? 0;
  if (s.status === "completed") return { percent: 100, done: null, total: null, restored };
  if (s.done == null || s.total == null) {
    return { percent: s.percent ?? null, done: null, total: null, restored };
  }
  const done = s.done + restored;
  const total = s.total + restored;
  return {
    percent: total > 0 ? Math.round((done / total) * 100) : (s.percent ?? null),
    done,
    total,
    restored,
  };
}
