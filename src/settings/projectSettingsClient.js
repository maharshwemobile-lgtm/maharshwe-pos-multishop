import { apiFetch } from '../phase2Api';

let settingsCache = null;

export async function loadProjectSettings(refresh = false) {
  if (!refresh && settingsCache) return settingsCache;
  const data = await apiFetch('/api/project-settings');
  settingsCache = data;
  return data;
}

export function clearProjectSettingsCache() {
  settingsCache = null;
}

export function peekProjectSettings() {
  return settingsCache;
}
