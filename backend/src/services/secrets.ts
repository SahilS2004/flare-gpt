/**
 * Unified secret accessor.
 *
 * Cloudflare offers two ways to provide secrets to a Worker:
 *   1. Legacy `wrangler secret put` - resolves to a plain string on env.X
 *   2. Cloudflare Secrets Store - resolves to a binding object with .get()
 *
 * For local dev we also fall back to plain `vars` and `.dev.vars` strings.
 *
 * `getSecret` accepts either shape so callers don't need to know which binding
 * style is in use. Always `await` it.
 */
export async function getSecret(env: any, key: string): Promise<string> {
  if (!env) return "";
  const binding = env[key];
  if (binding == null) return "";
  if (typeof binding === "string") return binding;
  if (typeof binding === "object" && typeof binding.get === "function") {
    try {
      const value = await binding.get();
      return typeof value === "string" ? value : String(value ?? "");
    } catch (error) {
      console.error(`Failed to read Secrets Store secret '${key}':`, error);
      return "";
    }
  }
  return String(binding);
}

/** Convenience helper: resolves several secrets in parallel. */
export async function getSecrets<T extends string>(
  env: any,
  keys: readonly T[]
): Promise<Record<T, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getSecret(env, key)] as const)
  );
  return Object.fromEntries(entries) as Record<T, string>;
}
