export type UserSettings = {
  theme: "dark" | "light";
  microphoneEnabled: boolean;
  useRedis: boolean;
  useVector: boolean;
  sidebarCollapsed: boolean;
};

const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark",
  microphoneEnabled: true,
  useRedis: true,
  useVector: true,
  sidebarCollapsed: false
};

function settingsKey(userId: string): string {
  return `settings:${userId}`;
}

function normalizeSettings(raw: any): UserSettings {
  return {
    theme: raw?.theme === "light" ? "light" : "dark",
    microphoneEnabled: raw?.microphoneEnabled !== false,
    useRedis: raw?.useRedis !== false,
    useVector: raw?.useVector !== false,
    sidebarCollapsed: raw?.sidebarCollapsed === true
  };
}

export async function getUserSettings(env: any, userId: string): Promise<UserSettings> {
  if (!env?.USER_SETTINGS) return DEFAULT_SETTINGS;

  try {
    const stored = await env.USER_SETTINGS.get(settingsKey(userId), "json");
    if (!stored) return DEFAULT_SETTINGS;
    return normalizeSettings(stored);
  } catch (error) {
    console.error("Failed to read user settings from KV:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function updateUserSettings(
  env: any,
  userId: string,
  updates: Partial<UserSettings>
): Promise<UserSettings> {
  const existing = await getUserSettings(env, userId);
  const merged = normalizeSettings({ ...existing, ...updates });

  if (!env?.USER_SETTINGS) return merged;

  try {
    await env.USER_SETTINGS.put(settingsKey(userId), JSON.stringify(merged));
  } catch (error) {
    console.error("Failed to write user settings to KV:", error);
  }

  return merged;
}

