import assert from "node:assert/strict";
import test from "node:test";

import { parseCookies } from "../worker/cookies.js";
import { seal, unseal } from "../worker/crypto.js";
import { handleRequest } from "../worker/index.js";
import { normalizeIssuePayload, normalizeReturnTo } from "../worker/validation.js";

const SESSION_SECRET = "test-session-secret-that-is-more-than-32-characters";
const env = {
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_OAUTH_SCOPE: "public_repo",
  SESSION_SECRET,
  ASSETS: { fetch: () => new Response("asset") }
};

async function readJson(response) {
  return response.json();
}

async function withMutedConsoleError(callback) {
  const original = console.error;
  console.error = () => {};
  try { return await callback(); }
  finally { console.error = original; }
}

test("暗号化したセッションを復号でき、改ざんは拒否する", async () => {
  const value = await seal({ accessToken: "secret", expiresAt: Date.now() + 1_000 }, SESSION_SECRET);
  assert.deepEqual(await unseal(value, SESSION_SECRET), {
    accessToken: "secret",
    expiresAt: (await unseal(value, SESSION_SECRET)).expiresAt
  });

  const lastCharacter = value.at(-1);
  const tampered = `${value.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
  assert.equal(await unseal(tampered, SESSION_SECRET), null);
});

test("Issue入力を正規化し、ラベルを重複排除する", () => {
  assert.deepEqual(normalizeIssuePayload({
    repository: " azumag/EasyIssue ",
    title: " 共有導線を追加 ",
    body: " 本文 ",
    labels: ["feature", " feature ", "mobile"]
  }), {
    repository: "azumag/EasyIssue",
    title: "共有導線を追加",
    body: "本文",
    labels: ["feature", "mobile"]
  });

  assert.throws(
    () => normalizeIssuePayload({ repository: "invalid", title: "x" }),
    (error) => error.code === "invalid_repository"
  );
  assert.throws(
    () => normalizeIssuePayload({ repository: "azumag/EasyIssue", title: " " }),
    (error) => error.code === "missing_title"
  );
});

test("OAuth return_toは同一オリジンの相対パスだけを許可する", () => {
  assert.equal(normalizeReturnTo("/share?text=hello"), "/share?text=hello");
  assert.equal(normalizeReturnTo("https://attacker.example/"), "/");
  assert.equal(normalizeReturnTo("//attacker.example/"), "/");
});

test("ヘルスチェックが応答する", async () => {
  const response = await handleRequest(new Request("https://easyissue.example/api/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, service: "easyissue" });
  assert.ok(response.headers.get("x-request-id"));
});

test("OAuth開始時に共有先を暗号化Cookieへ保持する", async () => {
  const request = new Request(
    "https://easyissue.example/api/auth/login?return_to=%2Fshare%3Ftext%3Dhello%26url%3Dhttps%253A%252F%252Fexample.com"
  );
  const response = await handleRequest(request, env);

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://github.com");
  assert.equal(location.pathname, "/login/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "client-id");
  assert.equal(location.searchParams.get("scope"), "public_repo");
  assert.equal(location.searchParams.get("redirect_uri"), "https://easyissue.example/api/auth/callback");
  assert.ok(location.searchParams.get("state"));

  const cookies = parseCookies(response.headers.get("set-cookie"));
  const state = await unseal(cookies.easyissue_oauth_state, SESSION_SECRET);
  assert.equal(state.returnTo, "/share?text=hello&url=https%3A%2F%2Fexample.com");
  assert.equal(state.state, location.searchParams.get("state"));
  assert.ok(response.headers.get("set-cookie").includes("HttpOnly"));
  assert.ok(response.headers.get("set-cookie").includes("Secure"));
});

test("未ログインのIssue作成を拒否する", async () => {
  const response = await withMutedConsoleError(() => handleRequest(new Request("https://easyissue.example/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://easyissue.example" },
    body: JSON.stringify({ repository: "azumag/EasyIssue", title: "test" })
  }), env));

  assert.equal(response.status, 401);
  const data = await readJson(response);
  assert.equal(data.error.code, "authentication_required");
});

test("別オリジンからのIssue作成を拒否する", async () => {
  const response = await withMutedConsoleError(() => handleRequest(new Request("https://easyissue.example/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ repository: "azumag/EasyIssue", title: "test" })
  }), env));

  assert.equal(response.status, 403);
  assert.equal((await readJson(response)).error.code, "invalid_origin");
});

test("ログイン済みセッションでGitHub Issue APIを呼び出す", async () => {
  const session = await seal({
    accessToken: "github-access-token",
    scope: "public_repo",
    expiresAt: Date.now() + 60_000
  }, SESSION_SECRET);
  let received;
  const fetchImpl = async (url, init) => {
    received = { url, init };
    return new Response(JSON.stringify({
      number: 12,
      title: "共有導線を追加",
      html_url: "https://github.com/azumag/EasyIssue/issues/12"
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const response = await handleRequest(new Request("https://easyissue.example/api/issues", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `easyissue_session=${encodeURIComponent(session)}`,
      Origin: "https://easyissue.example"
    },
    body: JSON.stringify({
      repository: "azumag/EasyIssue",
      title: " 共有導線を追加 ",
      body: "参照元: https://example.com",
      labels: ["feature", "mobile"]
    })
  }), env, fetchImpl);

  assert.equal(response.status, 201);
  assert.equal(received.url, "https://api.github.com/repos/azumag/EasyIssue/issues");
  assert.equal(received.init.method, "POST");
  assert.equal(received.init.headers.Authorization, "Bearer github-access-token");
  assert.equal(received.init.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.deepEqual(JSON.parse(received.init.body), {
    title: "共有導線を追加",
    body: "参照元: https://example.com",
    labels: ["feature", "mobile"]
  });
  assert.deepEqual(await readJson(response), {
    issue: {
      number: 12,
      title: "共有導線を追加",
      url: "https://github.com/azumag/EasyIssue/issues/12",
      repository: "azumag/EasyIssue"
    }
  });
});

test("OAuth callbackでセッションを発行し共有画面へ戻す", async () => {
  const stateValue = "oauth-state";
  const oauthCookie = await seal({
    state: stateValue,
    returnTo: "/share?text=shared&url=https%3A%2F%2Fexample.com",
    expiresAt: Date.now() + 60_000
  }, SESSION_SECRET);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ access_token: "token", scope: "public_repo", token_type: "bearer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const response = await handleRequest(new Request(
    `https://easyissue.example/api/auth/callback?code=code-1&state=${stateValue}`,
    { headers: { Cookie: `easyissue_oauth_state=${encodeURIComponent(oauthCookie)}` } }
  ), env, fetchImpl);

  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location"), "https://easyissue.example");
  assert.equal(target.pathname, "/share");
  assert.equal(target.searchParams.get("text"), "shared");
  assert.equal(target.searchParams.get("url"), "https://example.com");
  assert.equal(target.searchParams.get("auth"), "ok");
  assert.equal(calls[0].url, "https://github.com/login/oauth/access_token");

  const setCookie = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")];
  assert.ok(setCookie.some((value) => value?.startsWith("easyissue_session=")));
  assert.ok(setCookie.some((value) => value?.startsWith("easyissue_oauth_state=")));
});
