/* Renders a `view=full` report as findings a person can actually read.
 *
 * Three layers, each answering the next question:
 *   1. How bad is it?      High / Medium / Low circles with their counts.
 *   2. Where is it?        A chart of the files with the most findings.
 *   3. What exactly?       The findings, worst first, searchable, with the
 *                          suggested fix one click away.
 * Clicking a circle or a file narrows the list; the active filters are
 * shown above it and clear in one click.
 *
 * Five severities come in (critical, high, medium, low, info) and three
 * levels go out: critical counts as High and info as Low, and each circle
 * says so when it happens, so no finding is hidden by the folding. The
 * JSON comes from a model's output several layers away, so every field is
 * optional and anything missing still renders. */

import { useMemo, useState } from "react";

interface Issue {
  title?: string;
  severity?: string;
  line?: number | null;
  description?: string;
  suggestion?: string;
  source?: string;
}

interface FileReview {
  file?: string;
  score?: number | null;
  summary?: string;
  issues?: Issue[];
  static_findings?: Issue[];
}

type Level = "high" | "medium" | "low";
const LEVELS: Level[] = ["high", "medium", "low"];
const LEVEL_LABEL: Record<Level, string> = { high: "High", medium: "Medium", low: "Low" };
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

type Finding = Issue & { file: string; level: Level; sev: string; key: string };
type Source = "all" | "ai" | "scanner";

const PAGE = 40;
const CHART_ROWS = 8;

function levelOf(severity: string): Level {
  if (severity === "critical" || severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

function sevRank(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** Scanner findings carry a `source` (semgrep, gitleaks, trivy); the
 *  model's own do not, or say "ai"/"llm". */
function isScanner(f: Issue): boolean {
  const s = (f.source ?? "").toLowerCase();
  return !!s && s !== "ai" && s !== "llm" && s !== "model";
}

function sourceName(f: Issue): string {
  if (!isScanner(f)) return "AI review";
  const s = f.source ?? "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function flatten(reviews: FileReview[]): Finding[] {
  const out: Finding[] = [];
  for (const r of reviews) {
    const file = r.file ?? "(unknown file)";
    [...(r.issues ?? []), ...(r.static_findings ?? [])].forEach((i, n) => {
      const sev = (i.severity ?? "info").toLowerCase();
      out.push({ ...i, file, sev, level: levelOf(sev), key: `${file}#${n}` });
    });
  }
  return out.sort((a, b) => sevRank(a.sev) - sevRank(b.sev) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

function LevelCircles({
  counts,
  folded,
  active,
  onPick,
}: {
  counts: Record<Level, number>;
  folded: { critical: number; info: number };
  active: Level | null;
  onPick: (l: Level | null) => void;
}) {
  return (
    <div className="levels" role="group" aria-label="Findings by severity">
      {LEVELS.map((l) => {
        const note =
          l === "high" && folded.critical
            ? `including ${folded.critical} critical`
            : l === "low" && folded.info
              ? `including ${folded.info} informational`
              : "";
        return (
          <button
            key={l}
            type="button"
            className={`level level-${l}${active === l ? " is-on" : ""}${counts[l] === 0 ? " is-zero" : ""}`}
            aria-pressed={active === l}
            onClick={() => onPick(active === l ? null : l)}
            title={active === l ? "Show all severities" : `Show only ${LEVEL_LABEL[l].toLowerCase()} findings`}
          >
            <span className="level-ring" aria-hidden="true">
              <span className="level-count">{counts[l]}</span>
            </span>
            <span className="level-name">{LEVEL_LABEL[l]}</span>
            <span className="level-sub">
              {counts[l] === 1 ? "1 finding" : `${counts[l]} findings`}
              {note && <span className="level-note">{note}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Files with the most findings, one stacked bar each (High, Medium, Low
 *  in that order, so the worst part always starts at the axis). */
function FileChart({
  findings,
  activeFile,
  onPick,
}: {
  findings: Finding[];
  activeFile: string | null;
  onPick: (file: string | null) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const rows = useMemo(() => {
    const by = new Map<string, Record<Level, number>>();
    for (const f of findings) {
      const row = by.get(f.file) ?? { high: 0, medium: 0, low: 0 };
      row[f.level] += 1;
      by.set(f.file, row);
    }
    const all = [...by.entries()]
      .map(([file, c]) => ({ file, ...c, total: c.high + c.medium + c.low }))
      .sort((a, b) => b.high - a.high || b.total - a.total || a.file.localeCompare(b.file));
    return { top: all.slice(0, CHART_ROWS), rest: all.length - CHART_ROWS, files: all.length };
  }, [findings]);

  if (rows.top.length < 2) return null; // one file: the circles already said it all
  const max = Math.max(...rows.top.map((r) => r.total));

  return (
    <figure className="file-chart">
      <figcaption className="chart-head">
        <span className="chart-title">Where the findings are</span>
        <span className="chart-legend" aria-hidden="true">
          {LEVELS.map((l) => (
            <span key={l} className="legend-item">
              <span className={`legend-swatch fill-${l}`} />
              {LEVEL_LABEL[l]}
            </span>
          ))}
        </span>
      </figcaption>
      <ul className="chart-rows" onMouseLeave={() => setTip(null)}>
        {rows.top.map((r) => {
          const label = `${r.file}: ${r.high} high, ${r.medium} medium, ${r.low} low`;
          return (
            <li key={r.file}>
              <button
                type="button"
                className={`chart-row${activeFile === r.file ? " is-on" : ""}`}
                aria-pressed={activeFile === r.file}
                aria-label={`${label}. ${activeFile === r.file ? "Show all files" : "Show only this file"}`}
                onClick={() => onPick(activeFile === r.file ? null : r.file)}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.closest(".file-chart") as HTMLElement).getBoundingClientRect();
                  setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: label });
                }}
                onFocus={(e) => {
                  const box = (e.currentTarget.closest(".file-chart") as HTMLElement).getBoundingClientRect();
                  const me = e.currentTarget.getBoundingClientRect();
                  setTip({ x: me.left - box.left + 40, y: me.top - box.top, text: label });
                }}
                onBlur={() => setTip(null)}
              >
                <span className="chart-file" title={r.file}>
                  {shortPath(r.file)}
                </span>
                <span className="chart-bar" style={{ width: `${(r.total / max) * 100}%` }}>
                  {LEVELS.filter((l) => r[l]).map((l) => (
                    <span key={l} className={`chart-seg fill-${l}`} style={{ flexGrow: r[l] }} />
                  ))}
                </span>
                <span className="chart-total">{r.total}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.rest > 0 && (
        <p className="chart-foot">
          {rows.rest} more {rows.rest === 1 ? "file has" : "files have"} findings. Search below to find them.
        </p>
      )}
      {tip && (
        <span className="chart-tip" role="presentation" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>
      )}
    </figure>
  );
}

export function FindingsView({ data }: { data: unknown }) {
  const report = (data ?? {}) as {
    reviews?: FileReview[];
    failures?: Array<{ file?: string; error?: string }>;
    skipped?: Array<{ path?: string; reason?: string }>;
    deterministic?: { unmatched?: { files?: string[]; findings_total?: number } };
  };
  const findings = useMemo(() => flatten(report.reviews ?? []), [report.reviews]);
  const [level, setLevel] = useState<Level | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [extra, setExtra] = useState<"failed" | "unmatched" | null>(null);

  const failures = report.failures ?? [];
  const unmatched = report.deterministic?.unmatched;
  const unmatchedCount = unmatched?.findings_total ?? 0;
  const unmatchedFiles = unmatched?.files ?? [];

  const counts: Record<Level, number> = { high: 0, medium: 0, low: 0 };
  const folded = { critical: 0, info: 0 };
  for (const f of findings) {
    counts[f.level] += 1;
    if (f.sev === "critical") folded.critical += 1;
    if (f.level === "low" && f.sev !== "low") folded.info += 1;
  }
  const scannerCount = findings.filter(isScanner).length;

  const q = query.trim().toLowerCase();
  const shown = findings.filter(
    (f) =>
      (!level || f.level === level) &&
      (!file || f.file === file) &&
      (source === "all" || (source === "scanner") === isScanner(f)) &&
      (!q ||
        [f.title, f.description, f.file, f.source].some((t) => (t ?? "").toLowerCase().includes(q))),
  );
  const filtered = !!(level || file || source !== "all" || q);

  function pick(fn: () => void) {
    fn();
    setLimit(PAGE);
  }

  if (findings.length === 0 && unmatchedCount === 0 && failures.length === 0) {
    return (
      <div className="findings-empty">
        <p className="findings-empty-title">No findings</p>
        <p className="quiet">Neither the scanners nor the AI reported a problem in the reviewed files.</p>
      </div>
    );
  }

  return (
    <div className="findings">
      <LevelCircles counts={counts} folded={folded} active={level} onPick={(l) => pick(() => setLevel(l))} />

      {(failures.length > 0 || unmatchedCount > 0) && (
        <div className="gaps">
          {failures.length > 0 && (
            <button
              type="button"
              className={`gap-link gap-failed${extra === "failed" ? " is-on" : ""}`}
              aria-pressed={extra === "failed"}
              onClick={() => setExtra(extra === "failed" ? null : "failed")}
            >
              {failures.length === 1 ? "1 file was" : `${failures.length} files were`} not reviewed
            </button>
          )}
          {unmatchedCount > 0 && (
            <button
              type="button"
              className={`gap-link gap-hidden${extra === "unmatched" ? " is-on" : ""}`}
              aria-pressed={extra === "unmatched"}
              onClick={() => setExtra(extra === "unmatched" ? null : "unmatched")}
            >
              {unmatchedCount} scanner {unmatchedCount === 1 ? "finding is" : "findings are"} in files the AI did not
              read
            </button>
          )}
        </div>
      )}

      {extra === "failed" && (
        <div className="gap-panel">
          <p>
            Reviewing these files failed, so they have no findings. Treat them as <strong>unchecked</strong>, not as
            clean.
          </p>
          {failures.map((f, idx) => (
            <div className="failed-file" key={`${f.file}-${idx}`}>
              <span className="failed-name">{f.file ?? "(unknown file)"}</span>
              {f.error && <span className="failed-reason">{f.error}</span>}
            </div>
          ))}
        </div>
      )}
      {extra === "unmatched" && (
        <div className="gap-panel">
          <p>
            Semgrep, Gitleaks and Trivy scan the whole repository; the AI reads a filtered part of it. These{" "}
            {unmatchedCount} findings are in {unmatchedFiles.length} {unmatchedFiles.length === 1 ? "file" : "files"}{" "}
            outside that part. The report keeps their count and files, not the findings themselves.
          </p>
          {unmatchedFiles.map((path) => (
            <div className="failed-file failed-file-hidden" key={path}>
              <span className="failed-name">{path}</span>
              <span className="failed-reason">
                {report.skipped?.find((s) => s.path === path)?.reason ?? "not part of the reviewed file set"}
              </span>
            </div>
          ))}
        </div>
      )}

      <FileChart findings={findings} activeFile={file} onPick={(f) => pick(() => setFile(f))} />

      {findings.length > 0 && (
        <div className="finding-tools">
          <input
            type="search"
            className="finding-search"
            placeholder="Search findings, files or rules"
            aria-label="Search findings"
            value={query}
            onChange={(e) => pick(() => setQuery(e.target.value))}
          />
          {scannerCount > 0 && scannerCount < findings.length && (
            <div className="source-filter" role="group" aria-label="Who found it">
              {(
                [
                  ["all", "All"],
                  ["ai", "AI review"],
                  ["scanner", "Scanners"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tab${source === value ? " is-on" : ""}`}
                  aria-pressed={source === value}
                  onClick={() => pick(() => setSource(value))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {filtered && (
        <p className="finding-filters">
          Showing {shown.length} of {findings.length}
          {level && <span className="filter-chip">{LEVEL_LABEL[level]}</span>}
          {file && <span className="filter-chip mono">{shortPath(file)}</span>}
          <button
            type="button"
            className="btn btn-link btn-small"
            onClick={() =>
              pick(() => {
                setLevel(null);
                setFile(null);
                setSource("all");
                setQuery("");
              })
            }
          >
            Clear filters
          </button>
        </p>
      )}

      {findings.length > 0 && shown.length === 0 && <p className="quiet">Nothing matches these filters.</p>}

      <ol className="finding-list">
        {shown.slice(0, limit).map((f) => (
          <li key={f.key}>
            <details className={`finding finding-${f.level}`}>
              <summary>
                <span className={`level-pill pill-${f.level}`}>
                  <span className={`legend-swatch fill-${f.level}`} />
                  {f.sev === "critical" ? "Critical" : f.sev === "info" ? "Info" : LEVEL_LABEL[f.level]}
                </span>
                <span className="finding-title">{f.title ?? "Untitled finding"}</span>
                <span className="finding-meta">
                  <span className="finding-loc">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </span>
                  <span className={`finding-source${isScanner(f) ? " is-scanner" : ""}`}>{sourceName(f)}</span>
                </span>
              </summary>
              <div className="finding-body">
                {f.description && <p>{f.description}</p>}
                {f.suggestion && (
                  <div className="finding-fix">
                    <span className="finding-fix-label">How to fix it</span>
                    <p>{f.suggestion}</p>
                  </div>
                )}
                {!f.description && !f.suggestion && <p className="quiet">No further detail in the report.</p>}
              </div>
            </details>
          </li>
        ))}
      </ol>
      {shown.length > limit && (
        <button type="button" className="btn btn-quiet show-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
        </button>
      )}
    </div>
  );
}

export default FindingsView;
