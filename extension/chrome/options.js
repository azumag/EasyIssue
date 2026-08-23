const DEFAULT_BASE_URL = "http://localhost:8787";
const form = document.querySelector("#options-form");
const input = document.querySelector("#base-url");
const status = document.querySelector("#status");

const saved = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL });
input.value = saved.baseUrl;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = new URL(input.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    const normalized = `${url.origin}${url.pathname.replace(/\/$/u, "")}`;
    await chrome.storage.sync.set({ baseUrl: normalized });
    input.value = normalized;
    status.textContent = "保存しました。";
  } catch {
    status.textContent = "http または https のURLを入力してください。";
  }
});
