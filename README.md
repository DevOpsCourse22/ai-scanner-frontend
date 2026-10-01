# AI Scan Repos frontend

The web interface for AI Scan Repos, a platform that scans the full
repository at a selected commit, not just changed files, for security
vulnerabilities and other security findings. Semgrep checks source code for
insecure patterns, Gitleaks detects exposed secrets, and Trivy analyzes
supported dependencies, infrastructure-as-code, and artifacts. The
deterministic scanner results are combined into one report; optional AI
analysis adds context, prioritizes findings, and suggests remediation
without replacing scanner evidence.

Users can start a repository scan, follow its progress, pause or resume it,
and review the results. The frontend communicates with the gateway, not
review-api directly. It is built into static files and served by nginx.

## Pages

| Address | What it shows |
|---|---|
| `/` | The scan form (repository, branch, depth). Signed in, below it: **Running now**, **Waiting for you** (paused or stopped reviews, each with Resume) and **Recently finished** |
| `/history` | Every review started by the signed-in GitHub account, with Running / Paused / Terminated / Completed tabs |
| `/review/<id>` | One review: a big percentage, a sentence saying what is happening, Pause or Resume, the progress track, file-by-file progress and the report |
| `/settings` | Account, theme, animation, default depth and branch, "ask before pausing a deep review", **AI model** (service, API key, model, Test connection; editable by site admins only, read-only for everyone else) and "How reviews run" (scanners, where code goes, automatic reviews on push) |

These paths must not start with a prefix the Ingress sends to the gateway
(`/auth`, `/reviews`, `/providers`, `/webhook`, `/health`), which is why
history is `/history` and a review is `/review/<id>` (singular).
`nginx/default.conf` answers any other unknown path with `index.html`, so
a reload or a shared link opens the right page.

## How a person is recognised

By their GitHub account, through the gateway's OAuth login. The gateway
records the numeric GitHub user id (stable across renames) on every review
started while signed in, and keeps the last status it saw for each one in
Postgres. So after days away, signing in again shows which reviews are
paused, terminated or completed, even if review-api restarted meanwhile.
Settings are stored by the gateway per GitHub account; the browser keeps a
copy in `localStorage` (`aiscan.settings`) only so the theme is applied
before the request returns.

## The report

The report brings together findings from Semgrep, Gitleaks, and Trivy, with
optional AI-enriched analysis. Scanner findings are the deterministic
security evidence; AI adds contextual explanations and remediation guidance.
The report preserves finding sources so users can distinguish scanner output
from AI analysis, and records incomplete scanner coverage rather than
presenting a failed scan as clean.

Three circles, **High**, **Medium** and **Low**, each in its own color with
the number of findings under the name (critical counts as High and
informational as Low, said in small print). Clicking one filters the list.
Below them, "Where the findings are" is a stacked bar per file with a legend,
then a search box, an All / AI review / Scanners filter and one card per
finding. The palette (`--level-*` in `index.css`) was checked for colorblind
separation and contrast in light and dark mode, and every color also has a
text label.

## Deleting a review

The review page and each row in My reviews have **Delete**. It opens a
warning dialog that says what is lost for good (report, saved progress,
place in My reviews), with "Keep it" focused; a running review is stopped
first.

## Pause and resume

Pause asks the gateway, which asks review-api to stop the review's Job.
Progress is checkpointed after every file (deep) or batch (brief), so
Resume, even days later, continues from there on the **same commit**. The
file being reviewed at the moment of pausing is reviewed again. Quick
reviews have no checkpoint, so resuming one starts it over. Details in
[`docs/17-review-api.md`](../DevSecOps-Final-Project/docs/17-review-api.md#7a)
§7a and [`docs/job-container-contract.md`](../DevSecOps-Final-Project/docs/job-container-contract.md)
v4. Resuming skips Semgrep, Gitleaks and
Trivy when their results for that commit are already saved: it clones and
goes straight back to the AI review.

## Code map

**App entry and layout**

- `src/main.tsx` loads fonts and global styles, then mounts `<App>`.
- `src/App.tsx` defines the top bar, routes, and page titles.
- `src/index.css`, `src/App.css`, and `src/report.css` hold design tokens,
  application layout, and report styling.

**Pages and report**

- `src/pages/` contains Home, History, ReviewPage, and Settings.
- `src/FileTree.tsx` shows file-by-file review progress.
- `src/FindingsView.tsx` renders the structured findings report.

**Shared logic and components**

- `src/api.ts` defines gateway requests and response shapes.
- `src/lib/` contains routing, session and settings state, status mapping,
  and display formatting.
- `src/components/` contains progress, status, review controls and rows,
  segmented controls, notifications, and the logo.

**Static assets and serving**

- `public/` contains the favicon assets.
- `nginx/default.conf` serves the built app, handles SPA routes, and exposes
  `/healthz`.

## Design

Pine green (`--brand`) for actions, a highlighter yellow-green
(`--marker`) for "being marked now" (progress ink, the logo, the current
nav item), amber for paused, brick for stopped. Headings in Bricolage
Grotesque, text in Instrument Sans, code in JetBrains Mono, all bundled
from `@fontsource-variable/*`, so no font is fetched from a CDN. Every
colour is a token in `index.css`; dark mode only redefines tokens.
Animation is turned off by Settings → Animation → Less, or by the system's
reduced-motion setting unless Settings says Full.

## How to Run

### Prerequisites

- **Node.js 22 and npm** to install dependencies, run the development server,
  build the frontend, or lint it. npm is included with Node.js.
- **The AI Scan Repos gateway** at `http://localhost:8080` to use the app
  locally with its backend features. The frontend dev server itself starts
  at `http://localhost:5173`.
- **Docker** (Docker Desktop or another running Docker Engine) only if you
  want to build and run the container image.

### Local development

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # type-check, then build into dist/
npm run lint       # oxlint
```

`VITE_GATEWAY_URL` sets the gateway address at **build** time. The
Dockerfile builds with an empty value, so every call goes to the same
origin, which is how the Ingress serves it.

### Run with Docker

```bash
docker build -t review-frontend .
docker run --rm -p 127.0.0.1:8081:8080 review-frontend
```

There are no automated UI tests yet; check changes with `npm run build`,
`npm run lint` and a look in the browser in light, dark and phone width.
