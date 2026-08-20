const URL_PATTERN = /https?:\/\/[^\s<>()]+/iu;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function clamp(value, maximum) {
  return value.length > maximum ? value.slice(0, maximum) : value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function findFirstUrl(value) {
  if (typeof value !== "string") return "";
  const match = value.match(URL_PATTERN);
  return match ? match[0].replace(/[.,、。!?！？)\]}]+$/u, "") : "";
}

function titleFromText(text) {
  return text
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry && !/^https?:\/\//iu.test(entry)) ?? "";
}

function titleFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./u, ""); }
  catch { return ""; }
}

export function buildSharedDraft(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams ?? "");
  const sharedTitle = (params.get("title") ?? "").trim();
  const sharedText = (params.get("text") ?? "").trim();
  const explicitUrl = (params.get("url") ?? "").trim();
  const sharedUrl = explicitUrl || findFirstUrl(sharedText);

  let title = sharedTitle;
  if (!title || title === sharedUrl || /^https?:\/\//iu.test(title)) {
    title = titleFromText(sharedText) || titleFromUrl(sharedUrl);
  }

  let text = sharedText;
  if (sharedUrl && sharedText === sharedUrl) text = "";
  else if (sharedUrl) text = sharedText.replace(new RegExp(`\\s*${escapeRegExp(sharedUrl)}\\s*$`, "u"), "").trim();

  const bodyParts = [];
  if (text) bodyParts.push(text);
  if (sharedUrl) bodyParts.push(`参照元: ${sharedUrl}`);

  return {
    title: clamp(title, 256),
    body: clamp(bodyParts.join("\n\n"), 65_000),
    sharedUrl
  };
}

export function normalizeRepositoryInput(value) {
  const repository = typeof value === "string" ? value.trim() : "";
  return REPOSITORY_PATTERN.test(repository) ? repository : "";
}

export function uniqueRepositories(values) {
  const repositories = [];
  for (const value of Array.isArray(values) ? values : []) {
    const repository = normalizeRepositoryInput(value);
    if (repository && !repositories.includes(repository)) repositories.push(repository);
  }
  return repositories;
}
