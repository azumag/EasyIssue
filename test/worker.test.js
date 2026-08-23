import assert from "node:assert/strict";
import test from "node:test";

import { parseCookies } from "../worker/cookies.js";
import { seal, unseal } from "../worker/crypto.js";
import { listRepositories } from "../worker/github.js";
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

test("GitHubリポジトリ一覧を複数ページから取得し、重複を整理する", async () => {
  const firstPage = [
    { full_name: "azumag/EasyIssue", private: false, has_issues: true, description: "", pushed_at: "2026-08-20T00:00:00Z" },
    ...Array.from({ length: 99 }, (_, index) => ({
      full_name: `azumag/repository-${index}`,
      private: false,
      has_issues: true
    }))
  ];
  const pages = [
    firstPage,
    [
      { full_name: "azumag/another", private: true, has_issues: true, description: "private" },
      { full_name: "azumag/EasyIssue", private: false, has_issues: true, description: "updated", pushed_at: "2026-08-21T00:00:00Z" }
    ]
  ];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(pages[requests.length - 1]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const repositories = await listRepositories("github-access-token", fetchImpl);

  assert.equal(repositories.length, 101);
  assert.deepEqual(
    repositories.find((repository) => repository.fullName === "azumag/EasyIssue"),
    {
      fullName: "azumag/EasyIssue",
      private: false,
      description: "updated",
      pushedAt: "2026-08-21T00:00:00Z"
    }
  );
  assert.deepEqual(
    repositories.find((repository) => repository.fullName === "azumag/another"),
    { fullName: "azumag/another", private: true, description: "private", pushedAt: null }
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url }) => url.startsWith("https://api.github.com/user/repos?")));
  assert.equal(new URL(requests[0].url).searchParams.get("page"), "1");
  assert.equal(new URL(requests[1].url).searchParams.get("page"), "2");
  assert.ok(requests.every(({ init }) => init.headers.Authorization === "Bearer github-access-token"));
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
