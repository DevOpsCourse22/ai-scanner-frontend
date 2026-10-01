// Settings, AI model: which AI service every review on this site uses.
// One choice for the whole site, so admins edit it and everyone else sees
// it read-only. The API key is write-only: once saved, only its last four
// characters ever come back from the server.

import { useEffect, useMemo, useState } from "react";
import {
  getAiPresets,
  getAiSettings,
  resetAiSettings,
  saveAiSettings,
  testAiSettings,
  type AiChoice,
  type AiPreset,
  type AiPresetList,
  type AiSettings,
  type AiTestResult,
} from "../api";
import { exactTime, timeAgo } from "../lib/format";
import { useToast } from "./Toasts";

function whereCodeGoes(p: AiPreset | undefined): string {
  if (!p) return "";
  return p.location === "cloud"
    ? `Reviews send the code being reviewed to ${p.label}.`
    : "Reviews stay on your network: the code goes only to your own server.";
}

function Current({ ai, presets }: { ai: AiSettings; presets: AiPresetList | null }) {
  if (!ai.configured) {
    const d = presets?.server_default;
    return (
      <p className="ai-current">
        Reviews use the server's default
        {d ? (
          <>
            : <span className="mono">{d.model || "the model it has loaded"}</span> on {d.provider}.
          </>
        ) : (
          "."
        )}
      </p>
    );
  }
  const p = presets?.presets.find((x) => x.name === ai.preset);
  return (
    <p className="ai-current">
      Reviews use <strong>{p?.label ?? ai.preset}</strong>
      {ai.model && (
        <>
          , model <span className="mono">{ai.model}</span>
        </>
      )}
      {ai.endpoint && (
        <>
          {" "}
          at <span className="mono">{ai.endpoint}</span>
        </>
      )}
      .{" "}
      {ai.updated_by && (
        <span className="quiet">
          Set by {ai.updated_by}{" "}
          <time dateTime={ai.updated_at ?? undefined} title={exactTime(ai.updated_at)}>
            {timeAgo(ai.updated_at)}
          </time>
          .
        </span>
      )}
    </p>
  );
}

export default function AiModelSettings() {
  const toast = useToast();
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [presets, setPresets] = useState<AiPresetList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<AiChoice>({ preset: "local", endpoint: "", model: "", api_key: "" });
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings()
      .then((s) => {
        setAi(s);
        if (s.configured) {
          setChoice({ preset: s.preset ?? "local", endpoint: s.endpoint ?? "", model: s.model ?? "", api_key: "" });
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this setting."));
    getAiPresets()
      .then(setPresets)
      .catch(() => setPresets({ presets: [], server_default: null }));
  }, []);

  const preset = useMemo(() => presets?.presets.find((p) => p.name === choice.preset), [presets, choice.preset]);
  const keySavedForThis = !!ai?.key_saved && ai.preset === choice.preset;

  function change(patch: Partial<AiChoice>) {
    setChoice((c) => ({ ...c, ...patch }));
    setTest(null);
    setError(null);
  }

  async function runTest() {
    setTesting(true);
    setError(null);
    try {
      setTest(await testAiSettings(choice));
    } catch (err) {
      setTest({ reachable: false, error: err instanceof Error ? err.message : "The test did not run." });
    } finally {
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (preset?.needs_key && !choice.api_key && !keySavedForThis) {
      setError(`${preset.label} needs an API key.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAiSettings(choice);
      setAi(saved);
      setChoice((c) => ({ ...c, api_key: "" }));
      setShowKey(false);
      toast("AI model saved. New reviews and resumed ones use it.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!window.confirm("Go back to the server's default AI model? The saved API key is deleted.")) return;
    try {
      setAi(await resetAiSettings());
      setChoice({ preset: "local", endpoint: "", model: "", api_key: "" });
      setTest(null);
      toast("Back to the server's default.", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not reset.");
    }
  }

  if (loadError) return <p className="inline-error">{loadError}</p>;
  if (!ai) return <p className="quiet">Loading…</p>;

  if (!ai.can_edit) {
    return (
      <>
        <Current ai={ai} presets={presets} />
        <p className="hint">Only site admins can change this. Ask one of them if reviews should use another model.</p>
      </>
    );
  }

  const models = test?.reachable ? (test.models ?? []) : [];

  return (
    <form className="ai-form" onSubmit={save}>
      <Current ai={ai} presets={presets} />

      <fieldset className="services">
        <legend className="setting-name">Service</legend>
        {(presets?.presets ?? []).map((p) => (
          <label key={p.name} className={`service${choice.preset === p.name ? " is-on" : ""}`}>
            <input
              type="radio"
              name="ai-preset"
              value={p.name}
              checked={choice.preset === p.name}
              onChange={() => change({ preset: p.name, endpoint: "", api_key: "", model: "" })}
            />
            <span className="service-name">{p.label}</span>
            <span className={`service-where where-${p.location}`}>
              {p.location === "cloud" ? "Cloud service" : "Your network"}
            </span>
          </label>
        ))}
        {presets && presets.presets.length === 0 && (
          <p className="inline-error">The review service did not answer, so the list of services is empty.</p>
        )}
      </fieldset>

      {preset && <p className={`notice${preset.location === "cloud" ? " notice-cloud" : ""}`}>{whereCodeGoes(preset)}</p>}

      {choice.preset === "local" && (
        <div className="setting">
          <label className="setting-name" htmlFor="ai-endpoint">
            Address
          </label>
          <input
            id="ai-endpoint"
            type="text"
            className="mono-input"
            placeholder={presets?.server_default?.base_url ?? "e.g. 100.83.14.22:1234"}
            value={choice.endpoint}
            maxLength={255}
            onChange={(e) => change({ endpoint: e.target.value })}
          />
          <span className="hint">
            Leave empty for the server's own LM Studio. Only private and Tailscale addresses are allowed.
          </span>
        </div>
      )}

      <div className="setting">
        <label className="setting-name" htmlFor="ai-key">
          API key{preset && !preset.needs_key ? " (optional)" : ""}
        </label>
        <div className="inline-field">
          <input
            id="ai-key"
            type={showKey ? "text" : "password"}
            className="mono-input"
            autoComplete="off"
            spellCheck={false}
            placeholder={keySavedForThis ? `Saved key ends in ${ai.key_hint?.replace("…", "")}. Leave empty to keep it` : "Paste the key"}
            value={choice.api_key}
            onChange={(e) => change({ api_key: e.target.value })}
            disabled={!ai.encryption_ready && !!preset?.needs_key}
          />
          <button type="button" className="btn btn-quiet" onClick={() => setShowKey((v) => !v)} disabled={!choice.api_key}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        {!ai.encryption_ready && preset?.needs_key ? (
          <span className="inline-error">
            This server can't store API keys yet: it has no GATEWAY_SETTINGS_KEY. See DEPLOY-K3S.md.
          </span>
        ) : (
          preset?.key_hint && <span className="hint">Get one at {preset.key_hint}. It is stored encrypted and never shown again.</span>
        )}
      </div>

      <div className="setting">
        <label className="setting-name" htmlFor="ai-model">
          Model
        </label>
        <div className="inline-field">
          <input
            id="ai-model"
            type="text"
            className="mono-input"
            list="ai-models"
            placeholder={preset?.example_model ? `e.g. ${preset.example_model}` : "model name"}
            value={choice.model}
            maxLength={255}
            onChange={(e) => change({ model: e.target.value })}
          />
          <button type="button" className="btn btn-quiet" onClick={runTest} disabled={testing}>
            {testing ? "Connecting…" : "Test connection"}
          </button>
        </div>
        <datalist id="ai-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {test &&
          (test.reachable ? (
            <span className="test-ok" role="status">
              Connected. {test.model_count ?? models.length} models available
              {models.length ? "; pick one from the list as you type." : "."}
              {choice.model && models.length > 0 && !models.includes(choice.model) && (
                <strong> {choice.model} is not one of them.</strong>
              )}
            </span>
          ) : (
            <span className="inline-error" role="alert">
              Could not connect: {test.error}
            </span>
          ))}
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save AI model"}
        </button>
        {ai.configured && (
          <button type="button" className="btn btn-link" onClick={reset}>
            Use the server's default instead
          </button>
        )}
      </div>
      <p className="hint">Applies to every new or resumed review on this site, including automatic ones.</p>
    </form>
  );
}
