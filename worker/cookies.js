export function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const { path = "/", maxAge, httpOnly = true, secure = true, sameSite = "Lax" } = options;
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (typeof maxAge === "number") attributes.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) attributes.push("HttpOnly");
  if (secure) attributes.push("Secure");
  if (sameSite) attributes.push(`SameSite=${sameSite}`);
  return attributes.join("; ");
}

export function clearCookie(name, options = {}) {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}
