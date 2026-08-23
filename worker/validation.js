import { AppError } from "./errors.js";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function normalizeRepository(value) {
  const repository = typeof value === "string" ? value.trim() : "";
  if (!repository || repository.length > 141 || !repositoryPattern.test(repository)) {
    throw new AppError(400, "invalid_repository", "リポジトリは owner/name 形式で指定してください");
  }
  return repository;
}

function normalizeLabels(value) {
  const labels = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = [];
  for (const label of labels) {
    if (typeof label !== "string") continue;
    const trimmed = label.trim();
    if (!trimmed) continue;
    if (trimmed.length > 50) throw new AppError(400, "invalid_labels", "ラベル名は50文字以内にしてください");
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  if (normalized.length > 20) throw new AppError(400, "invalid_labels", "ラベルは20件以内にしてください");
  return normalized;
}

export function normalizeIssuePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "invalid_payload", "送信内容が不正です");
  }
  const repository = normalizeRepository(value.repository);
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title) throw new AppError(400, "missing_title", "Issueタイトルを入力してください");
  if (title.length > 256) throw new AppError(400, "title_too_long", "Issueタイトルは256文字以内にしてください");
  if (body.length > 65_000) throw new AppError(400, "body_too_long", "Issue本文は65,000文字以内にしてください");
  return { repository, title, body, labels: normalizeLabels(value.labels) };
}

export function normalizeReturnTo(value) {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 2_048) return "/";
  return path;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AppError(403, "invalid_origin", "許可されていない送信元です");
  }
}
