const PIPELINE_URL = "https://privatools.me/pipeline?utm_source=extension";

function pipelineUrl(sourceUrl) {
  const url = new URL(PIPELINE_URL);
  if (sourceUrl) {
    url.searchParams.set("source", sourceUrl);
  }
  return url.toString();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "privatools-open-pipeline",
      title: "Open PrivaTools Pipeline",
      contexts: ["page", "link"],
    });
    chrome.contextMenus.create({
      id: "privatools-send-pdf",
      title: "Send PDF link to PrivaTools Pipeline",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pdf", "*://*/*.PDF"],
    });
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: pipelineUrl() });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const source = info.linkUrl || info.pageUrl || tab?.url || "";
  chrome.tabs.create({ url: pipelineUrl(source) });
});

