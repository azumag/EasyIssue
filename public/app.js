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
  elements.submit.querySelector("span").textContent = value ? "ä½œæˆä¸­â€¦" : "Issueã‚’ä½œæˆ";
}
function returnTo() { return `${location.pathname}${location.search}${location.hash}`; }
function updateLoginLink() { elements.login.href = `/api/auth/login?${new URLSearchParams({ return_to: returnTo() })}`; }

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `ãƒªã‚¯ã‚¨ã‚¹ãƒˆã«å¤±æ•—ã—ã¾ã—ãŸ (${response.status})`);
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
    login.textContent = "ãƒ­ã‚°ã‚¤ãƒ³";
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
  logout.textContent = "ãƒ­ã‚°ã‚¢ã‚¦ãƒˆ";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      state.authenticated = false; state.viewer = null; state.available = []; state.loaded = false;
      renderSession(); showToast("ãƒ­ã‚°ã‚¢ã‚¦ãƒˆã—ã¾ã—ãŸ");
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
    setStatus(`ãƒ­ã‚°ã‚¤ãƒ³çŠ¶æ…‹ã‚’ç¢ºèªã§ãã¾ã›ã‚“: ${error.message}`);
  }
  renderSession();
}

function renderRepositoryOptions(preferred = "") {
  const previous = normalizeRepositoryInput(preferred) || normalizeRepositoryInput(elements.repository.value) || getSelected();
  elements.repository.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.favorites.length ? "ç™»éŒ²å…ˆã‚’é¸æŠž" : "ç™»éŒ²å…ˆã‚’è¿½åŠ ã—ã¦ãã ã•ã„";
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
    .map((fullName) => ({ fullName, private: false, description: "æ‰‹å…¥åŠ›ã§è¿½åŠ " }));
  const repositories = [...state.available, ...manual]
    .filter((entry) => !query || entry.fullName.toLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  elements.list.replaceChildren();
  if (!repositories.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.loaded ? "è©²å½“ã™ã‚‹ãƒªãƒã‚¸ãƒˆãƒªã¯ã‚ã‚Šã¾ã›ã‚“ã€‚" : "GitHubã‹ã‚‰å–å¾—ã™ã‚‹ã¨ã€é¸æŠžå¯èƒ½ãªãƒªãƒã‚¸ãƒˆãƒªã‚’è¡¨ç¤ºã—ã¾ã™ã€‚";
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
    description.textContent = repository.description?.trim() || (repository.private ? "éžå…¬é–‹ãƒªãƒã‚¸ãƒˆàêˆˆˆ¹ak:e¢øàê¸àçxà®8àâ8àêˆŠNÂˆ^˜\[™
]K\ØÜš\[ÛŠNÈ][K˜\[™
ÚXÚØ›Þ^
NÈ[[Y[Ë›\Ý˜\[™
][JNÂˆBŸB‚˜\Þ[˜È[˜Ý[ÛˆØY™\ÜÚ]ÜšY\Ê
HÂˆYˆ
\Ý]K˜]][XØ]Y
HÈ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H‘Ú]X¸àn8àëxà¬8à©8àìøàfxà¢øàj9. :)©øà¤¹cå¹o¥øàiøàcxào¸àfxà ˆŽÈ™]\›ŽÈBˆ[[Y[Ëœ™[ØY™\ØX›YHYNÂˆ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H‘Ú]X¸àbøà¢ycå¹o¥ù.+x )ˆŽÂˆžHÂˆÛÛœÝ]HH]ØZ]™\]Y\ÝœÛÛŠ‹Ø\KÜ™\ÜÚ]ÜšY\ÈŠNÂˆÝ]K˜]˜Z[X›HH\œ˜^Kš\Ð\œ˜^J]Kœ™\ÜÚ]ÜšY\ÊHÈ]Kœ™\ÜÚ]ÜšY\Èˆ×NÂˆÝ]K›ØYYHYNÂˆ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H	ÜÝ]K˜]˜Z[X›K›[™Ýy.í¸à¤¹cå¹o¥øàeøào¸àeøàgøà ˜Âˆ™[™\”™\ÜÚ]ÜžS\Ý

NÂˆHØ]Ú
\œ›ÜŠHÂˆ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H\œ›Ü‹›Y\ÜØYÙNÂˆYˆ
\œ›Ü‹˜ÛÙHOOH˜]][XØ][Û—Ü™\]Z\™YŠH]ØZ]ØYÙ\ÜÚ[ÛŠ
NÂˆHš[˜[HÈ[[Y[Ëœ™[ØY™\ØX›YH\Ý]K˜]][XØ]YÈBŸB‚™[˜Ý[ÛˆÜ[”™\ÜÚ]ÜžQX[ÙÊ
HÂˆÝ]K™˜Y˜]›Üš]\ÈH™]ÈÙ]
Ý]K™˜]›Üš]\ÊNÂˆ[[Y[ËœÙX\˜Ú˜[YHHˆŽÈ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[HˆŽÂˆ™[™\”™\ÜÚ]ÜžS\Ý

NÂˆYˆ
\[Ùˆ[[Y[Ë™X[ÙËœÚÝÓ[Ù[OOH™[˜Ý[ÛˆŠH[[Y[Ë™X[ÙËœÚÝÓ[Ù[

NÂˆ[ÙH[[Y[Ë™X[ÙËœÙ]]šX]J›Ü[ˆ‹ˆŠNÂˆYˆ
Ý]K˜]][XØ]Y	‰ˆ\Ý]K›ØYY
H›ÚYØY™\ÜÚ]ÜšY\Ê
NÂŸB‚™[˜Ý[ÛˆYX[X[™\ÜÚ]ÜžJ
HÂˆÛÛœÝ™\ÜÚ]ÜžHH›Ü›X[^™T™\ÜÚ]ÜžR[œ]
[[Y[Ë›X[X[˜[YJNÂˆYˆ
\™\ÜÚ]ÜžJHÈ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H›ÝÛ™\‹Ü™\ÜÚ]ÜžH9oh¹o#øàiùaiyb¦øàeøài¸àcøàh8àexàa8à ˆŽÈ™]\›ŽÈBˆÝ]K™˜Y˜]›Üš]\Ë˜Y
™\ÜÚ]ÜžJNÂˆ[[Y[Ë›X[X[˜[YHHˆŽÂˆ[[Y[Ëœ™\ÜÚ]ÜžSY\ÜØYÙK^ÛÛ[H	Ü™\ÜÚ]Üž_H8à¤º/ïyb¨9`&z(ç8àjøàeøào¸àeøàgøà ˜Âˆ™[™\”™\ÜÚ]ÜžS\Ý

NÂŸB‚™[˜Ý[Ûˆ™Yš[

HÂˆÛÛœÝ\›H™]ÈT“
ØØ][Û‹š™YŠNÂˆÛÛœÝ˜YHZ[Ú\™Y˜Y
\›œÙX\˜Ú\˜[\ÊNÂˆYˆ
˜Y]H	‰ˆY[[Y[Ë]K˜[YJH[[Y[Ë]K˜[YHH˜Y]NÂˆYˆ
˜Y˜›ÙH	‰ˆY[[Y[Ë˜›ÙK˜[YJH[[Y[Ë˜›ÙK˜[YHH˜Y˜›ÙNÂˆYˆ
\›œÙX\˜Ú\˜[\Ë™Ù]
˜]]ŠHOOH›ÚÈŠHÚÝÕØ\Ý
‘Ú]X¸àjøàëxà¬8à©8àìøàeøào¸àeøàgÈŠNÂˆ[ÙHYˆ
\›œÙX\˜Ú\˜[\Ë™Ù]
˜]]ŠHOOH™[šYYŠHÙ]Ý]\Ê‘Ú]X¸àëxà¬8à©8àìøàc8à«xàèøàìøà®øàêøàexà£8ào¸àeøàgøà ¹aiyb¦ùa¡yk®xàkù/çy£ xàexà£8ài¸àa8ào¸àfxà ˆŠNÂˆYˆ
\›œÙX\˜Ú\˜[\Ëš\Ê˜]]ŠJHÂˆ\›œÙX\˜Ú\˜[\Ë™[]J˜]]ŠNÂˆ\ÝÜžKœ™\XÙTÝ]JßKˆ‹	Ý\›œ]˜[Y_IÝ\›œÙX\˜ÚIÝ\›š\ÚX
NÂˆBˆ™\]Y\Ý[š[X][Û‘œ˜[YJ

HOˆ
˜Y]HÈ[[Y[Ë˜›ÙHˆ[[Y[Ë]JK™›ØÝ\Ê
JNÂŸB‚˜\Þ[˜È[˜Ý[ÛˆÝX›Z]\ÜÝYJ]™[
HÂˆ]™[œ™]™[Y˜][

NÈ[[Y[Ë˜Ü™X]YšY[ˆHYNÈÙ]Ý]\Ê
NÂˆYˆ
\Ý]K˜]][XØ]Y
HÂˆÙ]Ý]\Ê’\ÜÝYxà¤¹/g9¢$8àfxà¢øàjøàkÑÚ]X¸àn8àëxà¬8à©8àìøàeøài¸àcøàh8àexàa8à ˆŠNÂˆ[[Y[Ë˜]]›ÝXÙKšY[ˆH˜[ÙNÂˆ[[Y[Ë˜]]›ÝXÙKœØÜ›Û[ÕšY]ÊÈ™Z]š[ÜŽˆœÛ[ÛÝ‹›ØÚÎˆ˜Ù[\ˆˆJNÂˆ™]\›ŽÂˆBˆÛÛœÝ™\ÜÚ]ÜžHH›Ü›X[^™T™\ÜÚ]ÜžR[œ]
[[Y[Ëœ™\ÜÚ]ÜžK˜[YJNÂˆÛÛœÝ]HH[[Y[Ë]K˜[YKš[J
NÂˆYˆ
\™\ÜÚ]ÜžJHÈÙ]Ý]\Ê¹ænúc,¹ab8àk¸àê¸àçxà®8àâ8àê¸à¤º`n9¢§¸àeøài¸àcøàh8àexàa8à ˆŠNÈÜ[”™\ÜÚ]ÜžQX[ÙÊ
NÈ™]\›ŽÈBˆYˆ
]]JHÈÙ]Ý]\Ê’\ÜÝYxà¯øà©8àâ8àêøà¤¹aiyb¦øàeøài¸àcøàh8àexàa8à ˆŠNÈ[[Y[Ë]K™›ØÝ\Ê
NÈ™]\›ŽÈBˆÙ]\ÞJYJNÂˆžHÂˆÛÛœÝ]HH]ØZ]™\]Y\ÝœÛÛŠ‹Ø\KÚ\ÜÝY\È‹ÂˆY]Ùˆ”ÔÕ‹ˆ›ÙNˆ”ÓÓ‹œÝš[™ÚYžJÂˆ™\ÜÚ]ÜžK]K›ÙNˆ[[Y[Ë˜›ÙK˜[YKˆX™[Îˆ[[Y[Ë›X™[Ë˜[YKœÜ]
‹ŠK›X\

X™[
HOˆX™[š[J
JK™š[\Š›ÛÛX[ŠBˆJBˆJNÂˆ[[Y[Ë˜Ü™X]Y[šËš™YˆH]Kš\ÜÝYK\›Âˆ[[Y[Ë˜Ü™X]Y[šË^ÛÛ[H	Ù]Kš\ÜÝYKœ™\ÜÚ]Üž_HÉÙ]Kš\ÜÝYK›[X™\ŸH8à¤ºe¢øàcØÂˆ[[Y[Ë˜Ü™X]YšY[ˆH˜[ÙNÂˆ[[Y[Ë]K˜[YHHˆŽÈ[[Y[Ë˜›ÙK˜[YHHˆŽÈ[[Y[Ë›X™[Ë˜[YHHˆŽÂˆÙ]Ù[XÝY
™\ÜÚ]ÜžJNÈ\ÝÜžKœ™\XÙTÝ]JßKˆ‹‹ÈŠNÂˆÚÝÕØ\Ý
’\ÜÝYxà¤¹/g9¢$8àeøào¸àeøàgÈŠNÈ[[Y[Ë]K™›ØÝ\Ê
NÂˆHØ]Ú
\œ›ÜŠHÂˆÙ]Ý]\Ê\œ›Ü‹›Y\ÜØYÙJNÂˆYˆ
È˜]][XØ][Û—Ü™\]Z\™Y‹™Ú]X—ÜÙ\ÜÚ[Û—Ù^\™Y—Kš[˜ÛY\Ê\œ›Ü‹˜ÛÙJJH]ØZ]ØYÙ\ÜÚ[ÛŠ
NÂˆHš[˜[HÈÙ]\ÞJ˜[ÙJNÈBŸB‚™[˜Ý[Ûˆ™YÚ\Ý\‘]™[Ê
HÂˆ[[Y[Ë™›Ü›K˜Y]™[\Ý[™\ŠœÝX›Z]‹ÝX›Z]\ÜÝYJNÂˆ[[Y[Ë™›Ü›K˜Y]™[\Ý[™\ŠšÙ^YÝÛˆ‹
]™[
HOˆÂˆYˆ
]™[šÙ^HOOH‘[\ˆˆ	‰ˆ
]™[›Y]RÙ^H]™[˜Ý›Ù^JJHÈ]™[œ™]™[Y˜][

NÈ[[Y[Ë™›Ü›Kœ™\]Y\ÝÝX›Z]

NÈBˆJNÂˆ[[Y[Ëœ™\ÜÚ]ÜžK˜Y]™[\Ý[™\Š˜Ú[™ÙH‹

HOˆÙ]Ù[XÝY
[[Y[Ëœ™\ÜÚ]ÜžK˜[YJJNÂˆ[[Y[Ë›X[˜YÙK˜Y]™[\Ý[™\Š˜ÛXÚÈ‹Ü[”™\ÜÚ]ÜžQX[ÙÊNÂˆ[[Y[ËœÙX\˜Ú˜Y]™[\Ý[™\Šš[œ]‹™[™\”™\ÜÚ]ÜžS\Ý
NÂˆ[[Y[Ëœ™[ØY˜Y]™[\Ý[™\Š˜ÛXÚÈ‹ØY™\ÜÚ]ÜšY\ÊNÂˆ[[Y[Ë˜YX[X[˜Y]™[\Ý[™\Š˜ÛXÚÈ‹YX[X[™\ÜÚ]ÜžJNÂˆ[[Y[Ë›X[X[˜Y]™[\Ý[™\ŠšÙ^YÝÛˆ‹
]™[
HOˆÈYˆ
]™[šÙ^HOOH‘[\ˆŠHÈ]™[œ™]™[Y˜][

NÈYX[X[™\ÜÚ]ÜžJ
NÈHJNÂˆ[[Y[ËœØ]™K˜Y]™[\Ý[™\Š˜ÛXÚÈ‹

HOˆÂˆÝ]K™˜]›Üš]\ÈH[š\]YT™\ÜÚ]ÜšY\ÊË‹‹œÝ]K™˜Y˜]›Üš]\×JKœÛÜ

KŠHOˆK›ØØ[PÛÛ\\™JŠJNÂˆØ]™Q˜]›Üš]\Ê
NÈ™[™\”™\ÜÚ]ÜžSÜ[ÛœÊ
NÈÚÝÕØ\Ý
	ÜÝ]K™˜]›Üš]\Ë›[™Ýy.í¸àk¹ænúc,¹ab8à¤¹/çykf8àeøào¸àeøàgØ
NÂˆJNÂˆY]™[\Ý[™\Š˜™Y›Ü™Z[œÝ[›Û\‹
]™[
HOˆÂˆ]™[œ™]™[Y˜][

NÈÝ]Kš[œÝ[›Û\H]™[È[[Y[Ëš[œÝ[šY[ˆH˜[ÙNÂˆJNÂˆ[[Y[Ëš[œÝ[˜Y]™[\Ý[™\Š˜ÛXÚÈ‹\Þ[˜È

HOˆÂˆYˆ
\Ý]Kš[œÝ[›Û\
H™]\›ŽÂˆ]ØZ]Ý]Kš[œÝ[›Û\œ›Û\

NÈÝ]Kš[œÝ[›Û\H[È[[Y[Ëš[œÝ[šY[ˆHYNÂˆJNÂˆY]™[\Ý[™\Š˜\[œÝ[Y‹

HOˆÈÝ]Kš[œÝ[›Û\H[È[[Y[Ëš[œÝ[šY[ˆHYNÈÚÝÕØ\Ý
‘X\ÞR\ÜÝYxà¤¸à©8àìøà®xàâ8àï8àêøàeøào¸àeøàgÈŠNÈJNÂŸB‚˜\Þ[˜È[˜Ý[Ûˆ™YÚ\Ý\”Ù\šXÙUÛÜšÙ\Š
HÂˆYˆ
JœÙ\šXÙUÛÜšÙ\ˆˆ[ˆ˜]šYØ]ÜŠJH™]\›ŽÂˆžHÈ]ØZ]˜]šYØ]Ü‹œÙ\šXÙUÛÜšÙ\‹œ™YÚ\Ý\Š‹ÜÝËšœÈ‹ÈØÛÜNˆ‹ÈˆJNÈBˆØ]Ú
\œ›ÜŠHÈÛÛœÛÛKØ\›Š”Ù\šXÙHÛÜšÙ\ˆ™YÚ\Ý˜][Ûˆ˜Z[Y‹\œ›ÜŠNÈBŸB‚˜\Þ[˜È[˜Ý[ÛˆÝ\

HÂˆ™YÚ\Ý\‘]™[Ê
NÈ™[™\”™\ÜÚ]ÜžSÜ[ÛœÊ
NÈ™Yš[

NÂˆ]ØZ]›ÛZ\ÙK˜[
ÛØYÙ\ÜÚ[ÛŠ
K™YÚ\Ý\”Ù\šXÙUÛÜšÙ\Š
WJNÂˆYˆ
Ý]K˜]][XØ]Y	‰ˆÝ]K™˜]›Üš]\Ë›[™ÝOOH
HÙ][Y[Ý]
Ü[”™\ÜÚ]ÜžQX[ÙËL
NÂŸB›ÚYÝ\

NÂ