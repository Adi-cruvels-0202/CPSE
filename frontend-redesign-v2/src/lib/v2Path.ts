const V2_BASE = "/v2";

/** Prefix a raw same-origin path with the V2 app mount without duplicating it. */
export function v2Path(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === V2_BASE || normalized.startsWith(`${V2_BASE}/`)
    ? normalized
    : `${V2_BASE}${normalized}`;
}
