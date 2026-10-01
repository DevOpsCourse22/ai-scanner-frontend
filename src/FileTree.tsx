import { useEffect, useMemo, useState } from "react";
import {
  getReviewFiles,
  type ReviewFile,
  type ReviewFiles,
  type ScannerStatus,
} from "./api";

interface Props {
  triggerId: string;
  /** Poll while the review is still moving. A finished review's file list
   *  cannot change, so polling it forever would be pure noise on both the
   *  gateway and review-api. */
  running: boolean;
}

// Slower than the status poll (2s): the status line is a few numbers, this
// is a list of every file in the repository, and it only changes when a
// whole file finishes - which for a deep review is minutes, not seconds.
// The clocks on screen tick every second from the last answer instead.
const POLL_INTERVAL_MS = 5000;

// A per-viewer convenience, so browser storage is the right home for it:
// open by default, and if someone closes the view it stays closed for them.
const OPEN_KEY = "reviewStatus.fileTree.open";

function readOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true; // storage blocked (private window etc.): just default open
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage unavailable: the choice is simply not remembered.
  }
}

/** 45s / 12m 05s / 1h 20m - compact, and never a false-precision decimal. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

interface TreeNode {
  name: string;
  path: string;
  /** Folders only. A Map, not an object, so insertion order is the
   *  manifest's order rather than JavaScript's key ordering rules. */
  children?: Map<string, TreeNode>;
  /** Leaves only. */
  file?: ReviewFile;
}

/** Flat paths -> nested folders. The API deliberately returns a flat list
 *  (it is the honest shape of what the pipeline knows), so the grouping a
 *  reader wants is done here, where it costs one pass and no server work. */
function buildTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      if (isLeaf) {
        node.children!.set(part, { name: part, path, file });
        return;
      }
      let child = node.children!.get(part);
      if (!child) {
        child = { name: part, path, children: new Map() };
        node.children!.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

interface FolderSummary {
  files: number;
  failed: number;
  /** Null when no file below reported a line count (an older plan file). */
  lines: number | null;
  /** Worst state in the subtree: a folder with one failed file must not
   *  look finished just because the other nine succeeded. */
  state: ReviewFile["state"];
}

function summarize(node: TreeNode): FolderSummary {
  const seen = { failed: false, in_progress: false, pending: false };
  let files = 0;
  let failed = 0;
  let lines: number | null = null;
  const walk = (n: TreeNode) => {
    if (n.file) {
      files += 1;
      if (n.file.lines != null) lines = (lines ?? 0) + n.file.lines;
      if (n.file.state === "failed") failed += 1;
      if (n.file.state !== "done") seen[n.file.state] = true;
      return;
    }
    n.children?.forEach(walk);
  };
  walk(node);
  const state = seen.failed
    ? "failed"
    : seen.in_progress
      ? "in_progress"
      : seen.pending
        ? "pending"
        : "done";
  return { files, failed, lines, state };
}

const STATE_LABEL: Record<ReviewFile["state"], string> = {
  done: "reviewed",
  failed: "could not be reviewed",
  in_progress: "being reviewed now",
  pending: "waiting",
};

const STATE_MARK: Record<ReviewFile["state"], string> = {
  done: "✓",
  failed: "✕",
  in_progress: "●",
  pending: "·",
};

/** "gitleaks 2 · semgrep 1 · AI 1". Scanners first - deterministic, and
 *  what a security reader looks for - then the model. Null when there is
 *  nothing to count. */
function findingsLabel(file: ReviewFile): string | null {
  const parts = Object.entries(file.scanner_findings ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scanner, n]) => `${scanner} ${n}`);
  if ((file.issues ?? 0) > 0) parts.push(`AI ${file.issues}`);
  return parts.length ? parts.join(" · ") : null;
}

/** A finished file nothing flagged. Worded "no findings", never "clean" or
 *  "secure": an absence of findings is not evidence of safety, only that
 *  none of these checks raised anything. And it is only shown plainly when
 *  every applicable check really covered the file - otherwise the same words
 *  would reassure about a file a scanner never read. */
function NoFindings({ gaps }: { gaps: string[] | undefined }) {
  if (gaps && gaps.length === 0) {
    return (
      <span
        className="tree-no-findings"
        title="No scanner and not the AI reported anything here. That is not proof the file is secure - only that none of these checks flagged it."
      >
        no findings
      </span>
    );
  }
  const why = gaps?.length ? gaps.join("; ") : "scanner coverage for this file is unknown";
  return (
    <span className="tree-no-findings-partial" title={`No findings, but not every check covered this file: ${why}.`}>
      no findings · incomplete
    </span>
  );
}

function FileRow({
  file,
  name,
  depth,
}: {
  file: ReviewFile;
  /** Just the last path segment - the folder rows above already carry the
   *  rest, so repeating the full path on every leaf only adds width. */
  name: string;
  depth: number;
}) {
  const findings = findingsLabel(file);
  return (
    <div
      className={`tree-row tree-file tree-${file.state}`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      // State is carried by the mark and the title text as well as colour,
      // so it does not depend on colour alone to be readable.
      title={`${file.path} - ${STATE_LABEL[file.state]}${
        file.lines != null ? ` - ${plural(file.lines, "line", "lines")}` : ""
      }${file.error ? `: ${file.error}` : ""}`}
    >
      <span className="tree-mark" aria-hidden="true">{STATE_MARK[file.state]}</span>
      <span className="tree-name">{name}</span>
      <span className="visually-hidden">{STATE_LABEL[file.state]}</span>
      {/* Size in the row itself, so a slow file can be judged at a glance
          without hovering. */}
      <span className="tree-lines">
        {file.lines != null ? plural(file.lines, "line", "lines") : ""}
      </span>
      {/* Labelled by source: a bare "1 finding" once hid every scanner
          finding behind the model's single simulated one. */}
      {/* Always rendered, even empty, so the lines column lines up down
          the whole tree whatever each row's badge says. */}
      <span className="tree-tail">
        {file.state === "done" && findings && (
          <span
            className="tree-badge"
            title="Scanner findings are counted per scanner; AI counts what the model reported."
          >
            {findings}
          </span>
        )}
        {file.state === "done" && !findings && <NoFindings gaps={file.scan_gaps} />}
        {file.state === "failed" && <span className="tree-badge-failed">failed</span>}
      </span>
    </div>
  );
}

function FolderRow({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);
  const summary = useMemo(() => summarize(node), [node]);

  return (
    <>
      <button
        type="button"
        className={`tree-row tree-folder tree-${summary.state}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onToggle(node.path)}
        aria-expanded={!isCollapsed}
        title={
          summary.state === "done"
            ? "every file in this folder was reviewed"
            : summary.failed
              ? `${plural(summary.failed, "file", "files")} in this folder could not be reviewed`
              : undefined
        }
      >
        <span className="tree-mark" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
        <span className="tree-name">{node.name}/</span>
        <span className="tree-lines">
          {summary.lines != null ? plural(summary.lines, "line", "lines") : ""}
        </span>
        <span className="tree-tail">
          <span className="tree-count">
            {plural(summary.files, "file", "files")}
            {summary.failed > 0 && (
              <span className="tree-count-failed"> · {summary.failed} failed</span>
            )}
          </span>
        </span>
      </button>
      {!isCollapsed &&
        [...node.children!.values()].map((child) =>
          child.file ? (
            <FileRow key={child.path} file={child.file} name={child.name} depth={depth + 1} />
          ) : (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ),
        )}
    </>
  );
}

// What each scanner's "scanned_files" actually counts differs, and a label
// that pretended otherwise would overstate the coverage.
const SCANNER_COUNT_LABEL: Record<string, [string, string]> = {
  semgrep: ["file scanned", "files scanned"],
  trivy: ["dependency/config file", "dependency/config files"],
};

const SCANNER_NOTE: Record<string, string> = {
  gitleaks: "Gitleaks does not report which files it scanned - only what it found.",
  trivy: "Trivy scans dependency manifests, lockfiles and container/IaC files, not source code.",
};

/** One line per deterministic scanner. The point is the failure case: a
 *  scanner that failed silently otherwise just looks like a review with no
 *  scanner findings, and the report would quietly be AI-only. */
function ScannerStrip({ scanners }: { scanners: ScannerStatus | null | undefined }) {
  if (scanners === undefined) return null; // an older API that does not report it

  const names = scanners
    ? [...new Set([...scanners.run, ...Object.keys(scanners.failed)])].sort()
    : [];

  if (!scanners || names.length === 0) {
    return (
      <div className="scan-strip">
        <span className="scan-item scan-unknown">
          ⚠ No deterministic scanner results for this review - findings will be
          AI-only.
        </span>
      </div>
    );
  }

  return (
    <div className="scan-strip" aria-label="Deterministic scanners">
      {names.map((name) => {
        const failure = scanners.failed[name];
        if (failure) {
          return (
            <span key={name} className="scan-item scan-failed" title={failure}>
              ✕ {name} failed
            </span>
          );
        }
        const cov = scanners.coverage[name] ?? {};
        const count = typeof cov.scanned_files === "number" ? cov.scanned_files : null;
        const label = SCANNER_COUNT_LABEL[name] ?? ["file", "files"];
        const errors = typeof cov.errors === "number" ? cov.errors : 0;
        return (
          <span key={name} className="scan-item scan-ok" title={SCANNER_NOTE[name]}>
            ✓ {name}
            {count !== null && ` · ${plural(count, label[0], label[1])}`}
            {errors > 0 && (
              <span className="scan-errors"> · {plural(errors, "error", "errors")}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function CurrentFile({
  current,
  lines,
  secondsSinceFetch,
}: {
  current: NonNullable<ReviewFiles["current"]>;
  /** Shown so a reader can judge the estimate for themselves: "4 minutes"
   *  means something different for 40 lines than for 4,000. */
  lines: number | null | undefined;
  secondsSinceFetch: number;
}) {
  const elapsed = current.elapsed_seconds + secondsSinceFetch;
  const expected = current.expected_seconds;
  const overdue = expected !== null && elapsed > expected;
  // An estimate from the file's size, not a measurement - how long a model
  // thinks about a file is not knowable in advance. So the bar never claims
  // to be finished: it stops at 95% and says so if the file runs long.
  const percent = expected ? Math.min(95, (elapsed / expected) * 100) : null;

  return (
    <div className="tree-current">
      <div className="tree-current-line">
        <span className="tree-current-mark" aria-hidden="true">●</span>
        <span className="tree-current-path" title={current.path}>{current.path}</span>
        {lines != null && (
          <span className="tree-current-size">{plural(lines, "line", "lines")}</span>
        )}
        <span className="tree-current-time">
          {formatDuration(elapsed)}
          {expected !== null
            ? overdue
              ? " · taking longer than usual"
              : ` of ~${formatDuration(expected)} (estimate)`
            : " · estimating after the first file"}
        </span>
      </div>
      {percent !== null && (
        <div className="tree-current-bar" aria-hidden="true">
          <div className="tree-current-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function FileTree({ triggerId, running }: Props) {
  const [data, setData] = useState<ReviewFiles | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpenState] = useState(readOpen);

  function setOpen(next: boolean) {
    setOpenState(next);
    writeOpen(next);
  }

  // Same setTimeout-not-setInterval reasoning as the status poll: the next
  // request is only scheduled once the previous one has come back, so a
  // slow gateway cannot accumulate a queue of overlapping requests.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const next = await getReviewFiles(triggerId);
        if (cancelled) return;
        // null = the review has not written its plan yet (still cloning or
        // scanning). Keep whatever is on screen rather than blanking it.
        if (next) {
          setData(next);
          setFetchedAt(Date.now());
        }
        if (running) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load files");
      }
    }
    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [triggerId, running, open]);

  // One-second clock between polls, only while there is a live clock to show.
  useEffect(() => {
    if (!open || !running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [open, running]);

  const tree = useMemo(() => (data ? buildTree(data.files) : null), [data]);
  const sinceFetch = running && fetchedAt ? Math.max(0, (now - fetchedAt) / 1000) : 0;

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet btn-small tree-open" onClick={() => setOpen(true)}>
        ▸ Show file-by-file progress
        {data && ` (${data.counts.done}/${data.counts.total} files)`}
      </button>
    );
  }

  const eta =
    data?.eta_seconds != null ? Math.max(0, data.eta_seconds - sinceFetch) : null;

  return (
    <section className="tree-panel">
      <header className="tree-header">
        <button type="button" className="btn btn-link btn-small" onClick={() => setOpen(false)}>
          ▾ Hide file-by-file progress
        </button>
        {data && (
          <span className="tree-summary">
            {data.counts.done} reviewed · {data.counts.failed} failed ·{" "}
            {data.counts.in_progress} running · {data.counts.pending} waiting ·{" "}
            {data.counts.total} total
          </span>
        )}
      </header>

      {data && running && (
        <p
          className="tree-eta"
          title="Learned from how long files took so far in this review - by size, when bigger files have been measurably slower, and otherwise per file."
        >
          {eta !== null
            ? `About ${formatDuration(eta)} left for the whole review (estimate${
                data.estimate_based_on
                  ? ` from ${plural(data.estimate_based_on, "file", "files")}`
                  : ""
              })`
            : data.counts.pending + data.counts.in_progress > 0
              ? "Time left: estimating after the first file finishes"
              : null}
        </p>
      )}

      {data?.current && (
        <CurrentFile
          current={data.current}
          lines={data.files.find((f) => f.path === data.current!.path)?.lines}
          secondsSinceFetch={sinceFetch}
        />
      )}

      {data && <ScannerStrip scanners={data.scanners} />}

      {error && <p className="inline-error">{error}</p>}
      {!data && !error && (
        <p className="hint">
          Waiting for the review to finish cloning and scanning - the file list
          appears once it knows what it will cover.
        </p>
      )}

      {tree && (
        <div className="tree">
          {[...tree.children!.values()].map((child) =>
            child.file ? (
              <FileRow key={child.path} file={child.file} name={child.name} depth={0} />
            ) : (
              <FolderRow
                key={child.path}
                node={child}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

export default FileTree;
