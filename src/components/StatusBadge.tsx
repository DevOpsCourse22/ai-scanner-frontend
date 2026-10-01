import { groupOf, isLive, statusLabel } from "../lib/status";

/** A status as a word plus a shape, so it never depends on colour alone:
 *  a pulsing dot while live, two bars when paused, a cross when
 *  terminated, a tick when completed. */
export default function StatusBadge({
  status,
  pausing = false,
}: {
  status: string | null | undefined;
  pausing?: boolean;
}) {
  const group = pausing ? "paused" : groupOf(status);
  return (
    <span className={`badge badge-${group}${isLive(status) && !pausing ? " badge-live" : ""}`}>
      <span className="badge-mark" aria-hidden="true" />
      {statusLabel(status, pausing)}
    </span>
  );
}
