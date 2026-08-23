import { AppError } from "./errors.js";

const apiVersion = "2026-03-10";
const REPOSITORY_PAGE_SIZE = 100;
const MAX_REPOSITORY_PAGES = 10;
const apiBaseUrl = "https://api.github.com";

function githubHeaders(token, additional = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "EasyIssue",
    "X-GitHub-Api-Version": apiVersion,
    ...additional
  };
}

async function readJson(response) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return null;
  try { return await response.json(); } catch { return null; }
}

async function githubRequest(path, token, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${apiBaseUrl}${path}`, {
    ...init,
    headers: githubHeaders(token, init.headers)
  });
  const data = await readJson(response);
  if (!response.ok) {
    const message = data && typeof data.message === "string" ? data.message : "GitHub APIへのリクエストに失敗しました";
    throw new AppError(
      response.status === 401 ? 401 : response.status >= 500 ? 502 : response.status,
      response.status === 401 ? "github_session_expired" : "github_api_error",
      message,
      data?.errors
    );
  }
  return data;
}

export async function exchangeOAuthCode({ clientId, clientSecret, code, redirectUri }, fetchImpl = fetch) {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "EasyIssue"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) {
    throw new AppError(502, "oauth_exchange_failed", data?.error_description ?? "GitHub認証情報の取得に失敗しました");
  }
  return { accessToken: data.access_token, scope: data.scope ?? "", tokenType: data.token_type ?? "bearer" };
}

export async function getViewer(token, fetchImpl = fetch) {
  const data = await githubRequest("/user", token, {}, fetchImpl);
  return { login: data.login, name: data.name, avatarUrl: data.avatar_url, profileUrl: data.html_url };
}

export async function listRepositories(token, fetchImpl = fetch) {
  const baseQuery = {
    affiliation: "owner,collaborator,organization_member",
    direction: "desc",
    per_page: String(REPOSITORY_PAGE_SIZE),
    sort: "pushed"
  };

  const repositoriesByFullName = new Map();

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const query = new URLSearchParams({ ...baseQuery, page: String(page) });
    const data = await githubRequest(`/user/repos?${query}`, token, {}, fetchImpl);
    if (!Array.isArray(data)) break;

    for (const repository of data) {
      if (!repository?.has_issues || repository.archived || repository.disabled) continue;
      if (typeof repository.full_name !== "string") continue;

      repositoriesByFullName.set(repository.full_name, {
        fullName: repository.full_name,
        private: Boolean(repository.private),
        description: repository.description ?? "",
        pushedAt: repository.pushed_at ?? null
      });
    }

    if (data.length < REPOSITORY_PAGE_SIZE) break;
  }

  return [...repositoriesByFullName.values()];
}

export async function createIssue(token, input, fetchImpl = fetch) {
  const [owner, repository] = input.repository.split("/");
  const data = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        body: input.body || undefined,
        labels: input.labels.length > 0 ? input.labels : undefined
      })
    },
    fetchImpl
  );
  return { number: data.number, title: data.title, url: data.html_url, repository: input.repository };
}
