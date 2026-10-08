/**
 * Bundle version: `1.<yymmdd>.<hhmm>` in UTC. Valid semver, sorts by time, and
 * readable at a glance in the app footer. The APK bakes in the version it was
 * built at, so it only ever picks up bundles published after itself.
 */
export function bundleVersion(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const day = `${p(now.getUTCFullYear() % 100)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const minute = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  return `1.${Number(day)}.${Number(minute)}`;
}
