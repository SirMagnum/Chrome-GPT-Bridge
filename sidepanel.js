const capturePageButton = document.getElementById("capturePage");
const statusMessage = document.getElementById("statusMessage");

init();

function init() {
  capturePageButton.addEventListener("click", capturePage);
}

async function capturePage() {
  setStatusMessage("Starting drag selection on the active page...");

  const activeTab = await getFocusedNormalTab();
  if (!activeTab?.id) {
    setStatusMessage("No active page found.");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "start-page-capture" });
    if (!response?.ok) {
      setStatusMessage(response?.error || "Could not start page selection.");
      return;
    }

    setStatusMessage("Drag on the page to select an area. Release to send it to ChatGPT.");
  } catch (error) {
    console.error("Error sending capture message:", error);
    setStatusMessage("Error: " + error.message);
  }
}

function setStatusMessage(message) {
  statusMessage.textContent = message;
}

async function getFocusedNormalTab() {
  try {
    // Query for the first active tab in any normal window
    const tabs = await chrome.tabs.query({ active: true });
    if (tabs.length > 0) {
      return tabs[0];
    }

    // Fallback: get any tab that's not pinned and is in a normal window
    const allTabs = await chrome.tabs.query({ windowType: "normal" });
    return allTabs[0] || null;
  } catch (error) {
    console.error("Error querying tabs:", error);
    return null;
  }
}
