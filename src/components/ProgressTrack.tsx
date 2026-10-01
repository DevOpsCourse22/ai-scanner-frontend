// The progress bar: one line of "code" being marked with a highlighter,
// from cloning the repository to the finished report.
//
// The AI review is by far the longest stage (hours, in deep mode), so it
// gets most of the width; the short stages before it get a sliver each,
// enough to show they happened. The ink's tone carries the state as well
// as its label does: green-yellow while it runs, amber hatching when
// paused, grey with a red stop when terminated.

import { STAGES, groupOf, stageOf } from "../lib/status";

interface Props {
  status: string;
  /** Overall percent of the AI review, restored units included. */
  percent: number | null;
  pausing?: boolean;
  /** Compact: the history list's one-line version, no station names. */
  compact?: boolean;
}

// Where each station sits on the rail, in percent of its width.
const STATION_AT = [0, 9, 18, 100];

function inkWidth(stage: number, percent: number | null): number {
  if (stage >= 4) return 100;
  if (stage === 0) return 3;
  if (stage === 1) return 13;
  return STATION_AT[2] + ((100 - STATION_AT[2]) * Math.max(0, Math.min(100, percent ?? 0))) / 100;
}

export default function ProgressTrack({ status, percent, pausing = false, compact = false }: Props) {
  const stage = stageOf(status, percent);
  const group = groupOf(status);
  const tone = pausing ? "pausing" : group;
  const width = inkWidth(stage, percent);

  return (
    <div
      className={`track track-${tone}${compact ? " track-compact" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={
        percent != null ? `${percent}% - ${STAGES[Math.min(stage, 3)]}` : STAGES[Math.min(stage, 3)]
      }
    >
      <div className="track-rail">
        <div className="track-ink" style={{ width: `${width}%` }}>
          <span className="track-tip" aria-hidden="true" />
        </div>
      </div>
      {!compact && (
        <ol className="track-stations">
          {STAGES.map((name, i) => {
            const state = stage > i || stage === 4 ? "done" : stage === i ? "current" : "ahead";
            return (
              <li
                key={name}
                className={`station station-${state}`}
                style={{ left: `${STATION_AT[i]}%` }}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="station-dot" aria-hidden="true" />
                <span className="station-name">{name}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
