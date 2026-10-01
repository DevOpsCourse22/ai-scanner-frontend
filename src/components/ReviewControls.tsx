// Pause and Resume for one review. Used on the review page and in the
// history list, so a paused review can be picked up from wherever the
// person finds it.

import { useState } from "react";
import { ApiError, pauseReview, resumeReview, type ReviewStatus } from "../api";
import { useSession } from "../lib/session";
import { useToast } from "./Toasts";

interface Props {
  triggerId: string;
  status: ReviewStatus | null;
  mode?: string;
  /** Called with the gateway's answer, so the caller can show the new
   *  state at once instead of waiting for its next poll. */
  onChanged: (next: ReviewStatus) => void;
  compact?: boolean;
}

export default function ReviewControls({ triggerId, status, mode, onChanged, compact = false }: Props) {
  const { settings } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<"pause" | "resume" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.detached) return null;

  // In the cluster a pause stops at once and the file in flight is
  // reviewed again on resume; on a large deep-mode file that is real
  // work, so that is when it asks first (unless turned off in Settings).
  const askFirst = settings.confirm_pause && (mode ?? status.mode) === "deep";

  async function pause() {
    if (askFirst && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy("pause");
    setError(null);
    try {
      const next = await pauseReview(triggerId);
      onChanged(next);
      toast(
        next.status === "paused"
          ? "Paused. Resume it any time from My reviews."
          : "Pausing after the file in progress.",
        "info",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pause.");
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    setBusy("resume");
    setError(null);
    try {
      const next = await resumeReview(triggerId);
      onChanged(next);
      const restored = next.restored_units ?? 0;
      toast(
        restored > 0
          ? `Resumed. ${restored.toLocaleString()} finished ${mode === "deep" ? "files" : "parts"} are reused.`
          : "Resumed from the start: there was no checkpoint to reuse.",
        "success",
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sign in with GitHub to resume this review."
          : err instanceof Error
            ? err.message
            : "Could not resume.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`controls${compact ? " controls-compact" : ""}`}>
      {status.pausing && (
        <button type="button" className="btn btn-quiet" disabled>
          <span className="btn-glyph glyph-pause" aria-hidden="true" />
          Pausing…
        </button>
      )}
      {status.pausable && !status.pausing && !confirming && (
        <button type="button" className="btn btn-quiet" onClick={pause} disabled={busy !== null}>
          <span className="btn-glyph glyph-pause" aria-hidden="true" />
          {busy === "pause" ? "Pausing…" : "Pause"}
        </button>
      )}
      {confirming && (
        <div className="confirm" role="group" aria-label="Confirm pause">
          <span className="confirm-text">
            Finished files are kept. The file being reviewed right now starts again when you resume.
          </span>
          <button type="button" className="btn btn-quiet" onClick={pause}>
            Pause now
          </button>
          <button type="button" className="btn btn-link" onClick={() => setConfirming(false)}>
            Keep running
          </button>
        </div>
      )}
      {status.resumable && (
        <button type="button" className="btn btn-primary" onClick={resume} disabled={busy !== null}>
          <span className="btn-glyph glyph-play" aria-hidden="true" />
          {busy === "resume" ? "Resuming…" : "Resume"}
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
