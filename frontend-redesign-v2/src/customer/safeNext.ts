/** Only same-app paths are allowed as a post-sign-in return target. */
export function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}
