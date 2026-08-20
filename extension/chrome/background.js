const MENU_ID = "easyissue-create";
const DEFAULT_BASE_URL = "http://localhost:8787";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "EasyIssueでIssueを作成",
      contexts: ["page", "selection", "link"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  void openEasyIssue({
    title: tab?.title ?? "",
    text: info.selectionText ?? "",
    url: info.linkUrl ?? info.pageUrl ?? tab?.url ?? ""
  });
});

chrome.action.onClicked.addListener((tab) => {
  void openEasyIssue({ title: tab.title ?? "", text: "", url: tab.url ?? "" });
});

async function openEasyIssue(shared) {
  const { baseUrl = DEFAULT_BASE_URL } = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL });
  let base;
  try {
    base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("invalid protocol");
  } catch {
    await chrome.runtime.openOptionsPage();
    return;
  }

  base.pathname = "/share";
  base.search = new URLSearchParams(shared).toString();
  base.hash = "";
  await chrome.tabs.create({ url: base.toString() });
}
