// Delete a review, after a warning that says exactly what is lost. A modal
// <dialog>: the browser handles focus, Escape and the backdrop, and the
// safe choice ("Keep it") is the one focused when it opens.

import { useEffect, useRef, useState } from "react";
import { ApiError, deleteReview } from "../api";
import { useToast } from "./Toasts";

export default function DeleteReview({
  triggerId,
  repo,
  running,
  onDeleted,
  compact = false,
}: {
  triggerId: string;
  repo: string;
  running: boolean;
  onDeleted: () => void;
  compact?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      keep.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteReview(triggerId);
      setOpen(false);
      toast("Review deleted.", "success");
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "The review is still stopping. Try again in a few seconds."
          : err instanceof Error
            ? err.message
            : "Could not delete the review.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-quiet btn-danger${compact ? " btn-small" : ""}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={compact ? `Delete review of ${repo}` : undefined}
      >
        <span className="btn-glyph glyph-bin" aria-hidden="true" />
        {compact ? "Delete" : "Delete review"}
      </button>
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby={`del-${triggerId}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current && !busy) setOpen(false); // backdrop
        }}
      >
        <div className="dialog-body">
          <span className="dialog-mark" aria-hidden="true" />
          <h2 id={`del-${triggerId}`} className="dialog-title">
            Delete this review?
          </h2>
          <p>
            The review of <strong>{repo}</strong> is deleted for good: its report, its saved progress and its place in
            My reviews. It can't be resumed or recovered afterwards.
          </p>
          {running && <p className="notice">It is running now. Deleting stops it first.</p>}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button ref={keep} type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </button>
            <button type="button" className="btn btn-solid-danger" onClick={confirm} disabled={busy}>
              {busy ? "Deleting…" : "Delete review"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
