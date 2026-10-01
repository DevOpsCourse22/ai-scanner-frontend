// Who is signed in, and their preferences. One provider for both because
// the preferences come from the account: sign in on another machine and
// the site looks and behaves the same.
//
// Signed out, preferences live in this browser only (localStorage) and the
// Settings page says so.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_SETTINGS,
  getCurrentUser,
  getSettings,
  logout as apiLogout,
  saveSettings,
  type Settings,
  type User,
} from "../api";

const LOCAL_KEY = "aiscan.settings";

function readLocal(): Settings {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocal(settings: Settings): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private window): the choice lasts for this visit.
  }
}

/** Theme and motion are attributes on <html>, read by index.css. "system"
 *  removes the attribute so the operating system's choice applies. */
function applyToDocument(settings: Settings): void {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  if (settings.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = settings.motion;
}

interface SessionValue {
  /** undefined = still checking, null = signed out. */
  user: User | null | undefined;
  settings: Settings;
  /** Saves to the account when signed in, to this browser otherwise. */
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: undefined,
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>(readLocal);

  useEffect(() => {
    applyToDocument(settings);
  }, [settings]);

  useEffect(() => {
    getCurrentUser()
      .then(async (u) => {
        setUser(u);
        if (u) {
          const remote = await getSettings().catch(() => null);
          if (remote) {
            setSettings(remote);
            writeLocal(remote); // so the next visit paints in the right theme at once
          }
        }
      })
      .catch(() => setUser(null));
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      writeLocal(next);
      if (user) {
        // Optimistic: the page already shows the change. A failed save is
        // rethrown so the Settings page can say it was not kept.
        await saveSettings(next);
      }
    },
    [settings, user],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, settings, updateSettings, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
