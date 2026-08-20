import { buildSharedDraft, normalizeRepositoryInput, uniqueRepositories } from "./shared.js";

const FAVORITES_KEY = "easyissue.repositories.v1";
const SELECTED_KEY = "easyissue.selectedRepository.v1";
const byId = (id) => document.getElementById(id);
const elements = {
  session: byId("session-area"), authNotice: byId("auth-notice"), login: byId("login-link"),
  install: byId("install-button"), form: byId("issue-form"), repository: byId("repository"),
  title: byId("issue-title"), body: byId("issue-body"), labels: byId("issue-labels"),
  submit: byId("submit-button"), status: byId("form-status"), created: byId("created-issue"),
  createdLink: byId("created-issue-link"), manage: byId("manage-repositories"),
  dialog: byId("repository-dialog"), search: byId("repository-search"), reload: byId("reload-repositories"),
  list: byId("repository-list"), manual: byId("manual-repository"), addManual: byId("add-manual-repository"),
  repositoryMessage: byId("repository-message"), save: byId("save-repositories"), toast: byId("toast")
};

const state = {
  authenticated: false,
  viewer: null,
  favorites: loadFavorites(),
  available: [],
  draftFavorites: new Set(),
  loaded: false,
  installPrompt: null
};

function loadFavorites() {
  try { return uniqueRepositories(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]")); }
  catch { return []; }
}
function saveFavorites() { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); }
function getSelected() { return normalizeRepositoryInput(localStorage.getItem(SELECTED_KEY) ?? ""); }
function setSelected(value) {
  if (value) localStorage.setItem(SELECTED_KEY, value);
  else localStorage.removeItem(SELECTED_KEY);
}
function setStatus(message = "") { elements.status.textContent = message; }
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.hidden = true; }, 3200);
}
function setBusy(value) {
  elements.submit.disabled = value;
  elements.submit.querySelector("span").textContent = value ? "作成中…" : "Issueを作成";
}
function returnTo() { return `${location.pathname}${location.search}${location.hash}`; }
function updateLoginLink() { elements.login.href = `/api/auth/login?${new URLSearchParams({ return_to: returnTo() })}`; }

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `リクエストに失敗しました (${response.status})`);
    error.code = data?.error?.code ?? "request_failed";
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderSession() {
  elements.session.replaceChildren();
  elements.authNotice.hidden = state.authenticated;
  elements.reload.disabled = !state.authenticated;
  updateLoginLink();
  if (!state.authenticated || !state.viewer) {
    const login = document.createElement("a");
    login.className = "button button-secondary";
    login.href = elements.login.href;
    login.textContent = "ログイン";
    elements.session.append(login);
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "session-user";
  const avatar = document.createElement("img");
  avatar.src = state.viewer.avatarUrl;
  avatar.alt = "";
  const name = document.createElement("span");
  name.textContent = `@${state.viewer.login}`;
  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "text-button";
  logout.textContent = "ログアウト";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      state.authenticated = false; state.viewer = null; state.available = []; state.loaded = false;
      renderSession(); showToast("ログアウトしました");
    } catch (error) { showToast(error.message); }
    finally { logout.disabled = false; }
  });
  wrapper.append(avatar, name, logout);
  elements.session.append(wrapper);
}

async function loadSession() {
  try {
    const data = await requestJson("/api/session");
    state.authenticated = Boolean(data.authenticated);
    state.viewer = data.viewer ?? null;
  } catch (error) {
    state.authenticated = false; state.viewer = null;
    setStatus(`ログイン状態を確認できません: ${error.message}`);
  }
  renderSession();
}

function renderRepositoryOptions(preferred = "") {
  const previous = normalizeRepositoryInput(preferred) || normalizeRepositoryInput(elements.repository.value) || getSelected();
  elements.repository.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.favorites.length ? "登録先を選択" : "登録先を追加してください";
  elements.repository.append(placeholder);
  for (const repository of state.favorites) {
    const option = document.createElement("option");
    option.value = repository; option.textContent = repository;
    elements.repository.append(option);
  }
  const selected = state.favorites.includes(previous) ? previous : state.favorites[0] ?? "";
  elements.repository.value = selected;
  setSelected(selected);
}

function renderRepositoryList() {
  const query = elements.search.value.trim().toLowerCase();
  const known = new Set(state.available.map((entry) => entry.fullName));
  const manual = [...state.draftFavorites]
    .filter((name) => !known.has(name))
    .map((fullName) => ({ fullName, private: false, description: "手入力で追加" }));
  const repositories = [...state.available, ...manual]
    .filter((entry) => !query || entry.fullName.toLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  elements.list.replaceChildren();
  if (!repositories.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.loaded ? "該当するリポジトリはありません。" : "GitHubから取得すると、選択可能なリポジトリを表示します。";
    elements.list.append(empty); return;
  }
  for (const repository of repositories) {
    const item = document.createElement("label"); item.className = "repository-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.value = repository.fullName;
    checkbox.checked = state.draftFavorites.has(repository.fullName);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.draftFavorites.add(repository.fullName);
      else state.draftFavorites.delete(repository.fullName);
    });
    const text = document.createElement("span");
    const title = document.createElement("strong"); title.textContent = repository.fullName;
    if (repository.private) {
      const badge = document.createElement("span"); badge.className = "repository-badge"; badge.textContent = "private"; title.append(badge);
    }
    const description = document.createElement("small");
    description.textContent = repository.description?.trim() || (repository.private ? "非公開リポジトリ" : "公開リポジトリ");
    text.append(title, description); item.append(checkbox, text); elements.list.append(item);
  }
}

async function loadRepositories() {
  if (!state.authenticated) { elements.repositoryMessage.textContent = "GitHubへログインすると一覧を取得できます。"; return; }
  elements.reload.disabled = true;
  elements.repositoryMessage.textContent = "GitHubから取得中…";
  try {
    const data = await requestJson("/api/repositories");
    state.available = Array.isArray(data.repositories) ? data.repositories : [];
    state.loaded = true;
    elements.repositoryMessage.textContent = `${state.available.length}件を取得しました。`;
    renderRepositoryList();
  } catch (error) {
    elements.repositoryMessage.textContent = error.message;
    if (error.code === "authentication_required") await loadSession();
  } finally { elements.reload.disabled = !state.authenticated; }
}

function openRepositoryDialog() {
  state.draftFavorites = new Set(state.favorites);
  elements.search.value = ""; elements.repositoryMessage.textContent = "";
  renderRepositoryList();
  if (typeof elements.dialog.showModal === "function") elements.dialog.showModal();
  else elements.dialog.setAttribute("open", "");
  if (state.authenticated && !state.loaded) void loadRepositories();
}

function addManualRepository() {
  const repository = normalizeRepositoryInput(elements.manual.value);
  if (!repository) { elements.repositoryMessage.textContent = "owner/repository 形式で入力してください。"; return; }
  state.draftFavorites.add(repository);
  elements.manual.value = "";
  elements.repositoryMessage.textContent = `${repository} を追加候補にしました。`;
  renderRepositoryList();
}

function prefill() {
  const url = new URL(location.href);
  const draft = buildSharedDraft(url.searchParams);
  if (draft.title && !elements.title.value) elements.title.value = draft.title;
  if (draft.body && !elements.body.value) elements.body.value = draft.body;
  if (url.searchParams.get("auth") === "ok") showToast("GitHubにログインしました");
  else if (url.searchParams.get("auth") === "denied") setStatus("GitHubログインがキャンセルされました。入力内容は保持されています。");
  if (url.searchParams.has("auth")) {
    url.searchParams.delete("auth");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  requestAnimationFrame(() => (draft.title ? elements.body : elements.title).focus());
}

async function submitIssue(event) {
  event.preventDefault(); elements.created.hidden = true; setStatus();
  if (!state.authenticated) {
    setStatus("Issueを作成するにはGitHubへログインしてください。");
    elements.authNotice.hidden = false;
    elements.authNotice.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const repository = normalizeRepositoryInput(elements.repository.value);
  const title = elements.title.value.trim();
  if (!repository) { setStatus("登録先のリポジトリを選択してください。"); openRepositoryDialog(); return; }
  if (!title) { setStatus("Issueタイトルを入力してください。"); elements.title.focus(); return; }
  setBusy(true);
  try {
    const data = await requestJson("/api/issues", {
      method: "POST",
      body: JSON.stringify({
        repository, title, body: elements.body.value,
        labels: elements.labels.value.split(",").map((label) => label.trim()).filter(Boolean)
      })
    });
    elements.createdLink.href = data.issue.url;
    elements.createdLink.textContent = `${data.issue.repository} #${data.issue.number} を開く`;
    elements.created.hidden = false;
    elements.title.value = ""; elements.body.value = ""; elements.labels.value = "";
    setSelected(repository); history.replaceState({}, "", "/");
    showToast("Issueを作成しました"); elements.title.focus();
  } catch (error) {
    setStatus(error.message);
    if (["authentication_required", "github_session_expired"].includes(error.code)) await loadSession();
  } finally { setBusy(false); }
}

function registerEvents() {
  elements.form.addEventListener("submit", submitIssue);
  elements.form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); elements.form.requestSubmit(); }
  });
  elements.repository.addEventListener("change", () => setSelected(elements.repository.value));
  elements.manage.addEventListener("click", openRepositoryDialog);
  elements.search.addEventListener("input", renderRepositoryList);
  elements.reload.addEventListener("click", loadRepositories);
  elements.addManual.addEventListener("click", addManualRepository);
  elements.manual.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addManualRepository(); } });
  elements.save.addEventListener("click", () => {
    state.favorites = uniqueRepositories([...state.draftFavorites]).sort((a, b) => a.localeCompare(b));
    saveFavorites(); renderRepositoryOptions(); showToast(`${state.favorites.length}件の登録先を保存しました`);
  });
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); state.installPrompt = event; elements.install.hidden = false;
  });
  elements.install.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    await state.installPrompt.prompt(); state.installPrompt = null; elements.install.hidden = true;
  });
  addEventListener("appinstalled", () => { state.installPrompt = null; elements.install.hidden = true; showToast("EasyIssueをインストールしました"); });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("/sw.js", { scope: "/" }); }
  catch (error) { console.warn("Service worker registration failed", error); }
}

async function start() {
  registerEvents(); renderRepositoryOptions(); prefill();
  await Promise.all([loadSession(), registerServiceWorker()]);
  if (state.authenticated && state.favorites.length === 0) setTimeout(openRepositoryDialog, 250);
}
void start();
