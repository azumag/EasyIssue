import { clearCookie, parseCookies, serializeCookie } from "./cookies.js";
import { constantTimeEqual, randomToken, seal, unseal } from "./crypto.js";
import { AppError, toAppError } from "./errors.js";
import { createIssue, exchangeOAuthCode, getViewer, listRepositories } from "./github.js";
import { assertSameOrigin, normalizeIssuePayload, normalizeReturnTo } from "./validation.js";

const SESSION_COOKIE = "easyissue_session";
const OAUTH_STATE_COOKIE = "easyissue_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

function json(payload, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders
    }
  });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ "Cache-Control": "no-store", Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function cookieOptions(url) {
  return { path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" };
}

function requiredString(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(500, "invalid_configuration", `${name} が設定されていません`);
  }
  return value.trim();
}

function oauthConfiguration(env) {
  return {
    clientId: requiredString(env, "GITHUB_CLIENT_ID"),
    clientSecret: requiredString(env, "GITHUB_CLIENT_SECRET"),
    sessionSecret: requiredString(env, "SESSION_SECRET"),
    scope: typeof env.GITHUB_OAUTH_SCOPE === "string" && env.GITHUB_OAUTH_SCOPE.trim()
      ? env.GITHUB_OAUTH_SCOPE.trim()
      : "public_repo"
  };
}

async function readSession(request, env) {
  const sessionSecret = requiredString(env, "SESSION_SECRET");
  const cookies = parseCookies(request.headers.get("Cookie") ?? "");
  const encodedSession = cookies[SESSION_COOKIE];
  if (!encodedSession) return null;
  const session = await unseal(encodedSession, sessionSecret);
  if (!session || typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) {
    return null;
  }
  return session;
}

async function requireSession(request, env) {
  const session = await readSession(request, env);
  if (!session) throw new AppError(401, "authentication_required", "GitHubへのログインが必要です");
  return session;
}

function ensureMethod(request, expectedMethod) {
  if (request.method !== expectedMethod) {
    throw new AppError(405, "method_not_allowed", "許可されていないHTTPメソッドです");
  }
}

async function readJsonBody(request, maximumBytes = 100_000) {
  const contentLengthHeader = request.headers.get("Content-Length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new AppError(400, "invalid_content_length", "Content-Lengthが不正です");
    }
    if (contentLength > maximumBytes) {
      throw new AppError(413, "payload_too_large", "送信内容が大きすぎます");
    }
  }
  if (!request.body) throw new AppError(400, "invalid_json", "JSON形式の送信内容が必要です");

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new AppError(413, "payload_too_large", "送信内容が大きすぎます");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "invalid_json", "JSON形式の送信内容が必要です");
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new AppError(400, "invalid_json", "JSON形式の送信内容が必要です"); }
}

async function handleLogin(request, env) {
  ensureMethod(request, "GET");
  const url = new URL(request.url);
  const config = oauthConfiguration(env);
  const state = randomToken();
  const returnTo = normalizeReturnTo(url.searchParams.get("return_to"));
  const statePayload = await seal({
    state,
    returnTo,
    expiresAt: Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1_000
  }, config.sessionSecret);

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
  authorizeUrl.searchParams.set("scope", config.scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  return redirect(authorizeUrl.toString(), [
    serializeCookie(OAUTH_STATE_COOKIE, statePayload, {
      ...cookieOptions(url),
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS
    })
  ]);
}

async function handleCallback(request, env, fetchImpl) {
  ensureMethod(request, "GET");
  const url = new URL(request.url);
  const config = oauthConfiguration(env);
  const cookieSettings = cookieOptions(url);
  const clearState = clearCookie(OAUTH_STATE_COOKIE, cookieSettings);

  if (url.searchParams.get("error")) return redirect("/?auth=denied", [clearState]);

  const cookies = parseCookies(request.headers.get("Cookie") ?? "");
  const storedState = await unseal(cookies[OAUTH_STATE_COOKIE] ?? "", config.sessionSecret);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";

  if (!storedState || typeof storedState.state !== "string" || typeof storedState.expiresAt !== "number" || storedState.expiresAt <= Date.now() || !constantTimeEqual(storedState.state, state) || !code) {
    throw new AppError(400, "invalid_oauth_state", "GitHub認証の状態を確認できませんでした。もう一度ログインしてください");
  }

  const token = await exchangeOAuthCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri: `${url.origin}/api/auth/callback`
  }, fetchImpl);
  const session = await seal({
    accessToken: token.accessToken,
    scope: token.scope,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1_000
  }, config.sessionSecret);
  const target = new URL(normalizeReturnTo(storedState.returnTo), url.origin);
  target.searchParams.set("auth", "ok");

  return redirect(`${target.pathname}${target.search}${target.hash}`, [
    clearState,
    serializeCookie(SESSION_COOKIE, session, { ...cookieSettings, maxAge: SESSION_MAX_AGE_SECONDS })
  ]);
}

async function handleSession(request, env, fetchImpl) {
  ensureMethod(request, "GET");
  const url = new URL(request.url);
  const session = await readSession(request, env);
  if (!session) return json({ authenticated: false });
  try {
    const viewer = await getViewer(session.accessToken, fetchImpl);
    return json({ authenticated: true, viewer, scope: session.scope ?? "" });
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      return json({ authenticated: false, expired: true }, 200, {
        "Set-Cookie": clearCookie(SESSION_COOKIE, cookieOptions(url))
      });
    }
    throw error;
  }
}

async function handleLogout(request) {
  ensureMethod(request, "POST");
  assertSameOrigin(request);
  const url = new URL(request.url);
  return json({ ok: true }, 200, {
    "Set-Cookie": clearCookie(SESSION_COOKIE, cookieOptions(url))
  });
}

async function handleRepositories(request, env, fetchImpl) {
  ensureMethod(request, "GET");
  const session = await requireSession(request, env);
  const repositories = await listRepositories(session.accessToken, fetchImpl);
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase();
  const filtered = query
    ? repositories.filter((repository) => repository.fullName.toLowerCase().includes(query))
    : repositories;
  return json({ repositories: filtered });
}

async function handleCreateIssue(request, env, fetchImpl) {
  ensureMethod(request, "POST");
  assertSameOrigin(request);
  const session = await requireSession(request, env);
  const payload = await readJsonBody(request);
  const issue = await createIssue(session.accessToken, normalizeIssuePayload(payload), fetchImpl);
  return json({ issue }, 201);
}

async function routeApi(request, env, fetchImpl) {
  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case "/api/health":
      ensureMethod(request, "GET");
      return json({ ok: true, service: "easyissue" });
    case "/api/auth/login": return handleLogin(request, env);
    case "/api/auth/callback": return handleCallback(request, env, fetchImpl);
    case "/api/auth/logout": return handleLogout(request);
    case "/api/session": return handleSession(request, env, fetchImpl);
    case "/api/repositories": return handleRepositories(request, env, fetchImpl);
    case "/api/issues": return handleCreateIssue(request, env, fetchImpl);
    default: throw new AppError(404, "not_found", "APIが見つかりません");
  }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/")) {
      const response = await routeApi(request, env, fetchImpl);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    return env.ASSETS.fetch(request);
  } catch (error) {
    const appError = toAppError(error);
    console.error(JSON.stringify({
      event: "request_error",
      requestId,
      method: request.method,
      path: url.pathname,
      status: appError.status,
      code: appError.code,
      message: error instanceof Error ? error.message : String(error)
    }));
    return json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.status < 500 && appError.details ? { details: appError.details } : {})
      },
      requestId
    }, appError.status, { "X-Request-Id": requestId });
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env, fetch);
  }
};
