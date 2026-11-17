/** Only same-app paths are allowed as a post-sign-in return target. */
export function safeNext(next?: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  // Router destinations are relative to its /v2 base. A browser URL captured
  // from the address bar already includes that base, so strip it before
  // handing the destination back to TanStack Router.
  const target = next.replace(/^\/v2(?=\/|$)/, "") || "/";
  return /^\/login(?:\/|\?|#|$)/.test(target) ? "/" : target;
}
