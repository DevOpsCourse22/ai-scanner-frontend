// Settings: the person's own preferences (saved to their GitHub account),
// and a read-only view of how this deployment runs reviews.

import { useEffect, useState } from "react";
import { GATEWAY_URL, loginUrl, type Depth, type Motion, type Theme } from "../api";
import AiModelSettings from "../components/AiModelSettings";
import Segmented from "../components/Segmented";
import { useToast } from "../components/Toasts";
import { exactTime } from "../lib/format";
import { useSession } from "../lib/session";

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <div className="settings-aside">
        <h2 id={id}>{title}</h2>
        {intro && <p>{intro}</p>}
      </div>
      <div className="settings-body">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { user, settings, updateSettings, signOut } = useSession();
  const toast = useToast();
  const [branch, setBranch] = useState(settings.default_branch);

  useEffect(() => setBranch(settings.default_branch), [settings.default_branch]);

  async function save(patch: Parameters<typeof updateSettings>[0]) {
    try {
      await updateSettings(patch);
      toast(user ? "Saved to your account." : "Saved in this browser.", "success");
    } catch (err) {
      toast(err instanceof Error ? `Not saved: ${err.message}` : "Not saved.", "error");
    }
  }

  const webhookUrl = `${GATEWAY_URL || window.location.origin}/webhook`;

  return (
    <div className="page page-settings">
      <h1 className="page-title">Settings</h1>

      <Section id="s-account" title="Account" intro="Your reviews and settings belong to your GitHub account.">
        {user ? (
          <div className="account">
            {user.avatar_url && <img className="avatar avatar-large" src={user.avatar_url} alt="" width={64} height={64} />}
            <div className="account-text">
              <p className="account-name">{user.login}</p>
              <p className="quiet">
                GitHub account {user.github_user_id}
                {user.session_expires_at && (
                  <>
                    . Signed in until{" "}
                    <time dateTime={user.session_expires_at}>{exactTime(user.session_expires_at)}</time>
                  </>
                )}
              </p>
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => signOut().then(() => toast("Signed out.", "info"))}>
              Sign out
            </button>
          </div>
        ) : user === null ? (
          <div className="account">
            <p className="quiet account-text">
              You are not signed in. These settings are kept in this browser only.
            </p>
            <a className="btn btn-primary" href={loginUrl()}>
              Sign in with GitHub
            </a>
          </div>
        ) : (
          <p className="quiet">Checking sign-in…</p>
        )}
        {user && (
          <p className="hint">
            Signed in with the wrong account? GitHub signs you straight back in to the account it remembers.{" "}
            <a href="https://github.com/logout" target="_blank" rel="noreferrer">
              Sign out of GitHub
            </a>{" "}
            first, then sign in here again.
          </p>
        )}
      </Section>

      <Section id="s-look" title="Appearance">
        <div className="setting">
          <span className="setting-name">Theme</span>
          <Segmented<Theme>
            name="theme"
            legend="Theme"
            value={settings.theme}
            onChange={(theme) => save({ theme })}
            options={[
              { value: "system", label: "Match my system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <div className="setting">
          <span className="setting-name">Animation</span>
          <Segmented<Motion>
            name="motion"
            legend="Animation"
            value={settings.motion}
            onChange={(motion) => save({ motion })}
            options={[
              { value: "system", label: "Match my system" },
              { value: "reduce", label: "Less" },
              { value: "full", label: "Full" },
            ]}
          />
        </div>
      </Section>

      <Section id="s-defaults" title="New reviews" intro="What the form on the front page starts with.">
        <div className="setting">
          <span className="setting-name">Depth</span>
          <Segmented<Depth>
            name="default_mode"
            legend="Default depth"
            value={settings.default_mode}
            onChange={(default_mode) => save({ default_mode })}
            options={[
              { value: "quick", label: "Quick" },
              { value: "brief", label: "Brief" },
              { value: "deep", label: "Deep" },
            ]}
          />
        </div>
        <form
          className="setting"
          onSubmit={(e) => {
            e.preventDefault();
            save({ default_branch: branch.trim() });
          }}
        >
          <label className="setting-name" htmlFor="default_branch">
            Branch
          </label>
          <div className="inline-field">
            <input
              id="default_branch"
              type="text"
              maxLength={255}
              placeholder="the repository's default branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
            <button type="submit" className="btn btn-quiet" disabled={branch.trim() === settings.default_branch}>
              Save branch
            </button>
          </div>
        </form>
        <label className="setting setting-check">
          <input
            type="checkbox"
            checked={settings.confirm_pause}
            onChange={(e) => save({ confirm_pause: e.target.checked })}
          />
          <span>
            <span className="setting-name">Ask before pausing a deep review</span>
            <span className="hint">
              Pausing stops at once. The file being reviewed at that moment starts again when you resume.
            </span>
          </span>
        </label>
      </Section>

      {user && (
        <Section
          id="s-ai"
          title="AI model"
          intro="The AI service every review on this site runs on. One setting for everyone, changed by site admins."
        >
          <AiModelSettings />
        </Section>
      )}

      <Section id="s-system" title="How reviews run" intro="Shown so you know where your code goes.">
        <dl className="system">
          <div>
            <dt>Scanners</dt>
            <dd>
              Semgrep (code patterns), Gitleaks (secrets) and Trivy (vulnerable dependencies and configuration) run on
              every review, before the AI.
            </dd>
          </div>
          <div>
            <dt>Your code</dt>
            <dd>
              Copied into a temporary folder for the review and deleted when it ends. Only the report and the resume
              checkpoint stay on the server.
            </dd>
          </div>
        </dl>
        <details className="more">
          <summary>Review every push automatically</summary>
          <ol className="steps">
            <li>
              In the GitHub repository, open Settings, then Webhooks, then Add webhook.
            </li>
            <li>
              Payload URL: <code>{webhookUrl}</code>
            </li>
            <li>
              Content type: <code>application/json</code>
            </li>
            <li>
              Secret: ask the team for the shared webhook secret. Anyone holding it can start reviews, so keep it out of
              public repositories and issues.
            </li>
            <li>Events: the push event alone is enough.</li>
          </ol>
          <p className="hint">
            Each push then starts a Brief review. Those do not appear in My reviews, because nobody is signed in during a
            webhook call.
          </p>
        </details>
      </Section>
    </div>
  );
}
