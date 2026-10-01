// Everything the app knows about talking to the gateway lives here - one
// file, so if the gateway's shape changes there's exactly one place to fix.

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";

// "credentials: include" is what makes the browser send the session_id
// cookie on cross-origin requests (React on :5173, gateway on :8080) -
// without it, every authenticated call would silently look logged-out.
const fetchOptions: RequestInit = { credentials: "include" };

/** An error that kept the HTTP status, so callers can branch on it.
 *
 * Needed because the gateway deliberately answers "not yours" with 404
 * rather than 403 - it will not confirm that a review it won't show you
 * exists. That is the right call against someone guessing UUIDs, but it
 * means a 404 is ambiguous to the legitimate owner too: an expired
 * session looks exactly like a review that was never there.
 *
 * The UI resolves that ambiguity with something it already knows - the
 * viewer's own sign-in state - which discloses nothing about the review.
 * Parsing the status back out of a message string would have worked and
 * would have broken the first time someone reworded one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface User {
  login: string;
  /** GitHub's numeric account id: what every review and setting is keyed
   *  on, because it survives a username change. */
  github_user_id: number;
  avatar_url?: string;
  session_expires_at?: string;
  /** May change site-wide settings (the AI model). Set by the
   *  gateway-admins ConfigMap, not in the app. */
  is_admin?: boolean;
}

// null means "not logged in" - not an error, so callers don't need try/catch
// just to render a login button.
export async function getCurrentUser(): Promise<User | null> {
  const res = await fetch(`${GATEWAY_URL}/auth/me`, fetchOptions);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /auth/me failed: ${res.status}`);
  return res.json();
}

// Not a fetch - this is a real page navigation. The gateway redirects the
// whole browser to GitHub's consent screen, so there's nothing to await.
export function loginUrl(): string {
  return `${GATEWAY_URL}/auth/github/login`;
}

export async function logout(): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/auth/logout`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) throw new Error(`POST /auth/logout failed: ${res.status}`);
}

export interface ReviewMode {
  repo_url: string;
  branch?: string;
  mode?: "quick" | "brief" | "deep";
  files?: string[];
  // Name of a deterministic-scanner output already sitting in review-api's
  // reports/ folder (produced by `repo-scan`, see Code-Review-MCP/scanner) -
  // not a file upload. Optional: a review runs fine without one.
  findings_file?: string;
  // Which configured LLM endpoint should run the AI half of the review.
  // A NAME, never an address - see the gateway's ManualReviewRequest for
  // why an address would be an SSRF hole. Omitted means "the server's
  // default", which is what every review did before this existed.
  provider?: string;
}

/** One place the AI half of a review can run.
 *
 * This is what decouples a review from one particular machine being
 * awake: the same pipeline can send work to a laptop on the LAN, a box in
 * a server room, or a hosted API, and nothing else about the review
 * changes. `location` is what a user actually needs to know - whether
 * their code leaves the building. */
export interface Provider {
  name: string;
  description?: string;
  location?: string;
  default_model?: string;
  api_key_configured?: boolean;
  setup_hint?: string;
}

export interface ProviderList {
  default: string | null;
  providers: Provider[];
  /** review-api could not be reached. The list is empty but a review still
   *  runs on the server's default, so this is a note, not an error. */
  unavailable?: boolean;
}

export async function listProviders(): Promise<ProviderList> {
  const res = await fetch(`${GATEWAY_URL}/providers`, fetchOptions);
  if (!res.ok) {
    // The gateway already degrades gracefully; if even that fails, the
    // form should still render rather than block on a nicety.
    return { default: null, providers: [], unavailable: true };
  }
  return res.json();
}

export interface ReviewCreated {
  status: string;
  event: string;
  trigger_id: string;
  review_id: string;
}

/** The gateway's error sentence, when it sent one. FastAPI puts it in
 *  `detail`; a 422 carries a list there instead of a sentence. */
async function errorDetail(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  if (typeof body.detail === "string") return body.detail;
  return fallback;
}

export async function startReview(body: ReviewMode): Promise<ReviewCreated> {
  const res = await fetch(`${GATEWAY_URL}/reviews`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res, `Could not start the review (${res.status}).`));
  }
  return res.json();
}

// The gateway proxies review-api's status shape as-is - see
// backend/src/review_api/jobs.py for the full field list. Typed loosely
// here on purpose: only the fields the UI actually reads.
export interface ReviewStatus {
  status: string;
  review_id?: string;
  repo_url?: string;
  branch?: string | null;
  mode?: string;
  commit?: string | null;
  model?: string | null;
  /** True while a review is running and can be paused. */
  pausable?: boolean;
  /** Pause was asked for; the run stops after the unit in flight. */
  pausing?: boolean;
  /** Paused, failed, cancelled or interrupted: Resume continues it. */
  resumable?: boolean;
  paused_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  eta_seconds?: number | null;
  elapsed_seconds?: number | null;
  /** "disk": review-api rebuilt this from the reports volume after a
   *  restart. "gateway": the last status the gateway saw. */
  source?: "disk" | "gateway";
  /** A Job that review-api no longer tracks is still running it. */
  detached?: boolean;
  stats?: Record<string, unknown> | null;
  /** The gateway's own record of this review, when it sends one. */
  trigger?: MyReview;
  progress?: string;
  percent?: number | null;
  message?: string;
  error?: string;
  // review-api sets this when a checkpoint exists, so a failed review can
  // resume instead of re-reviewing every file it already finished.
  restartable?: boolean;
  // After a resume, done/total count only the REMAINING work, and
  // restored_units holds what the checkpoint gave back. All three are
  // needed to state progress against the original job - see
  // trueProgress() in ReviewStatus.
  restored_units?: number;
  done?: number | null;
  total?: number | null;
}

export async function getReviewStatus(triggerId: string): Promise<ReviewStatus> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}`, fetchOptions);
  if (!res.ok) {
    throw new ApiError(res.status, `GET /reviews/${triggerId} failed: ${res.status}`);
  }
  return res.json();
}

export type FileState = "done" | "failed" | "in_progress" | "pending";

export interface ReviewFile {
  path: string;
  language?: string | null;
  /** Character count, for time estimates. Never the content. */
  size?: number | null;
  /** Line count, for people sizing up a file at a glance. */
  lines?: number | null;
  state: FileState;
  // Only on finished files: how many issues were found, never what they
  // were. Issue detail lives in the report, which is fetched once at the
  // end rather than every few seconds like this is.
  /** Issues the MODEL reported. */
  issues?: number;
  /** Deterministic findings per scanner, e.g. {"gitleaks": 2}. Kept apart
   *  from `issues` because they are a different kind of evidence. */
  scanner_findings?: Record<string, number>;
  /** Only on finished files: what did NOT fully check this file (a scanner
   *  that failed, one that could only partly parse it). Empty means every
   *  applicable check covered it - the only case "no findings" may claim. */
  scan_gaps?: string[];
  score?: number | null;
  // Only on failed files: why OUR pipeline could not review it (model
  // returned no JSON, connection dropped) - not anything about the code.
  error?: string;
}

/** How each deterministic scanner fared on one review. `run` and `failed`
 *  are exact; what `scanned_files` counts differs per scanner, and is null
 *  for one (Gitleaks) that does not report it at all. */
export interface ScannerStatus {
  run: string[];
  failed: Record<string, string>;
  coverage: Record<string, { scanned_files?: number | null; errors?: number }>;
}

export interface ReviewFiles {
  review_id: string;
  status: string;
  mode?: string | null;
  counts: {
    total: number;
    done: number;
    failed: number;
    in_progress: number;
    pending: number;
  };
  /** The file being reviewed right now, with a size-based estimate for it.
   *  Null when nothing is running, after an API restart, or in kubernetes
   *  execution mode, where no live progress reaches the API. */
  current?: {
    path: string;
    elapsed_seconds: number;
    expected_seconds: number | null;
  } | null;
  /** Estimated seconds left for the whole review; null until a file has
   *  finished in this run and there is a rate to estimate from. */
  eta_seconds?: number | null;
  /** How many measured files the estimates rest on. */
  estimate_based_on?: number | null;
  /** Null = no scanner results were recorded for this review at all. */
  scanners?: ScannerStatus | null;
  files: ReviewFile[];
}

/** Per-file progress. A 404 here is the normal state for the first moments
 * of a review - the file list does not exist until cloning and file
 * selection have finished - so callers get null rather than an exception
 * and simply render nothing yet. */
export async function getReviewFiles(
  triggerId: string,
): Promise<ReviewFiles | null> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}/files`, fetchOptions);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(res.status, `GET /reviews/${triggerId}/files failed: ${res.status}`);
  }
  return res.json();
}

// Mirrors the gateway's own ?view= values (review-api's, really - the
// gateway just forwards it). "markdown" is not JSON - the server returns
// it as plain text/markdown, so the two branches below aren't just for
// typing convenience, they reflect a genuinely different response body.
export type ReportView = "summary" | "full" | "markdown";

export type ReportResult =
  | { view: "markdown"; text: string }
  | { view: "summary" | "full"; data: unknown };

export async function getReviewReport(
  triggerId: string,
  view: ReportView = "full",
): Promise<ReportResult> {
  const res = await fetch(
    `${GATEWAY_URL}/reviews/${triggerId}/report?view=${view}`,
    fetchOptions,
  );
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `GET /reviews/${triggerId}/report failed: ${res.status}`,
    );
  }
  if (view === "markdown") {
    return { view, text: await res.text() };
  }
  return { view, data: await res.json() };
}

// Only reviews started while logged in show up here - webhook triggers and
// logged-out manual reviews never had a github_user_id attached to them, so
// there's nothing to attribute them to (see gateway's db.py Trigger model).
export interface MyReview {
  trigger_id: string;
  repo_url: string;
  branch: string;
  mode: string;
  review_id: string;
  created_at: string;
  /** The last status the gateway saw - kept in its database, so it is
   *  still there after days away and after review-api restarts. */
  status?: string | null;
  /** Progress against the whole review, restored units included. */
  percent?: number | null;
  units_done?: number | null;
  units_total?: number | null;
  commit?: string | null;
  model?: string | null;
  error?: string | null;
  paused_at?: string | null;
  finished_at?: string | null;
  status_updated_at?: string | null;
}

export async function getMyReviews(): Promise<MyReview[]> {
  const res = await fetch(`${GATEWAY_URL}/reviews`, fetchOptions);
  if (!res.ok) throw new ApiError(res.status, `Could not load your reviews (${res.status}).`);
  return res.json();
}

/** Stop a running review so it can be resumed later - days later if
 *  need be. Resolves with the new status ("paused", or still running with
 *  `pausing: true` until the unit in flight finishes). */
export async function pauseReview(triggerId: string): Promise<ReviewStatus> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}/pause`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res, `Could not pause (${res.status}).`));
  }
  return res.json();
}

/** Continue a paused, failed or interrupted review from its checkpoint.
 *  `restored_units` says how many finished units were reused; 0 means it
 *  had nothing to reuse and starts over. */
export async function resumeReview(
  triggerId: string,
): Promise<ReviewStatus & { restored_units?: number; pinned_commit?: string | null }> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}/resume`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res, `Could not resume (${res.status}).`));
  }
  return res.json();
}

export type Theme = "system" | "light" | "dark";
export type Motion = "system" | "reduce" | "full";
export type Depth = "quick" | "brief" | "deep";

/** Preferences that follow the GitHub account, not the browser. */
export interface Settings {
  theme: Theme;
  motion: Motion;
  default_mode: Depth;
  default_branch: string;
  confirm_pause: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  motion: "system",
  default_mode: "brief",
  default_branch: "",
  confirm_pause: true,
};

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${GATEWAY_URL}/auth/me/settings`, fetchOptions);
  if (!res.ok) throw new ApiError(res.status, `Could not load settings (${res.status}).`);
  return { ...DEFAULT_SETTINGS, ...(await res.json()) };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const res = await fetch(`${GATEWAY_URL}/auth/me/settings`, {
    ...fetchOptions,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res, `Could not save settings (${res.status}).`));
  }
  return res.json();
}

// Resumes a failed review from its checkpoint, so only the files it never
// got to are reviewed again. Returns how many finished files the
// checkpoint gave back - 0 means it is really starting over.
export async function restartReview(triggerId: string): Promise<number | null> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}/restart`, {
    ...fetchOptions,
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Restart failed: ${res.status}`);
  }
  const body = await res.json();
  return body.restored_units ?? null;
}

// Removes the stored report only - the run itself stays in Recent reviews,
// because that row is metadata (repo, branch, depth, date) and holds no
// report content. Irreversible: the report cannot be recovered, only
// regenerated by running the review again.
export async function deleteReviewReport(triggerId: string): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}/report`, {
    ...fetchOptions,
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `DELETE report failed: ${res.status}`);
  }
}

// --- Settings, AI model: one choice for the whole site, changed by admins ---

/** An AI service the site can run reviews on. Cloud services have a fixed
 *  address; "local" takes one (LM Studio, Ollama or vLLM on the network). */
export interface AiPreset {
  name: string;
  label: string;
  location: "on_prem" | "cloud";
  base_url: string | null;
  needs_key: boolean;
  example_model: string;
  key_hint: string;
}

export interface AiPresetList {
  presets: AiPreset[];
  /** What reviews use while no choice is saved. */
  server_default: { provider: string; base_url: string; model: string | null } | null;
}

/** The saved choice. The key itself never comes back: only whether one is
 *  saved and its last four characters. */
export interface AiSettings {
  configured: boolean;
  preset?: string;
  endpoint?: string | null;
  model?: string | null;
  key_saved?: boolean;
  key_hint?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  can_edit: boolean;
  encryption_ready: boolean;
}

export interface AiChoice {
  preset: string;
  endpoint: string;
  model: string;
  /** Write-only. Empty keeps the saved key. */
  api_key: string;
  clear_key?: boolean;
}

export interface AiTestResult {
  reachable: boolean;
  models?: string[];
  model_count?: number;
  base_url?: string;
  error?: string;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, await errorDetail(res, fallback));
  return res.json();
}

export async function getAiSettings(): Promise<AiSettings> {
  const res = await fetch(`${GATEWAY_URL}/providers/ai`, fetchOptions);
  return jsonOrThrow(res, `Could not load the AI model setting (${res.status}).`);
}

export async function getAiPresets(): Promise<AiPresetList> {
  const res = await fetch(`${GATEWAY_URL}/providers/ai/presets`, fetchOptions);
  return jsonOrThrow(res, `Could not load the AI services (${res.status}).`);
}

export async function saveAiSettings(choice: AiChoice): Promise<AiSettings> {
  const res = await fetch(`${GATEWAY_URL}/providers/ai`, {
    ...fetchOptions,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice),
  });
  return jsonOrThrow(res, `Could not save (${res.status}).`);
}

export async function resetAiSettings(): Promise<AiSettings> {
  const res = await fetch(`${GATEWAY_URL}/providers/ai`, { ...fetchOptions, method: "DELETE" });
  return jsonOrThrow(res, `Could not reset (${res.status}).`);
}

export async function testAiSettings(choice: AiChoice): Promise<AiTestResult> {
  const res = await fetch(`${GATEWAY_URL}/providers/ai/test`, {
    ...fetchOptions,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice),
  });
  return jsonOrThrow(res, `Could not test the connection (${res.status}).`);
}

/** Delete a review completely: report, checkpoint, scan results and its
 *  place in My reviews. A running review is stopped first. Irreversible. */
export async function deleteReview(triggerId: string): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/reviews/${triggerId}`, { ...fetchOptions, method: "DELETE" });
  await jsonOrThrow(res, `Could not delete the review (${res.status}).`);
}
