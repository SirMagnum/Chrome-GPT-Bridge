const CHATGPT_WINDOW_KEY = "gpt_chatgpt_popup_window_id";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ask-gpt-selection",
      title: 'Ask GPT about "%s"',
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "capture-visible-page",
      title: "Capture visible page for GPT",
      contexts: ["page"]
    });
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get([CHATGPT_WINDOW_KEY]).then((result) => {
    if (result[CHATGPT_WINDOW_KEY] === windowId) {
      chrome.storage.local.remove(CHATGPT_WINDOW_KEY);
    }
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "ask-gpt-selection" && info.selectionText) {
    await openChatgptWithText(info.selectionText);
  }

  if (info.menuItemId === "capture-visible-page") {
    await openOrFocusChatgptPopup("https://chatgpt.com/");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "open-chatgpt-with-text") {
    openChatgptWithText(message.text || "")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "start-page-capture") {
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "capture-page-region") {
    captureVisibleTabForActiveBrowserWindow(sender?.tab?.windowId)
      .then((dataUrl) => cropCapturedRegion(dataUrl, message.rect, message.viewportWidth, message.viewportHeight))
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "send-image-to-chatgpt") {
    sendImageToChatgpt(message.dataUrl || "")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function openChatgptWithText(text) {
  if (!text) {
    throw new Error("Missing text.");
  }

  const popupWindow = await openOrFocusChatgptPopup("https://chatgpt.com/");
  const tab = await waitForChatgptTab(popupWindow?.id);
  if (!tab?.id) {
    throw new Error("Unable to open ChatGPT window.");
  }

  await waitForTabReady(tab.id);
  await injectTextIntoChatgptTab(tab.id, text);
}

async function openOrFocusChatgptPopup(url) {
  const storedWindow = await chrome.storage.local.get([CHATGPT_WINDOW_KEY]);
  const windowId = storedWindow[CHATGPT_WINDOW_KEY];

  if (typeof windowId === "number") {
    try {
      const existingWindow = await chrome.windows.get(windowId, { populate: true });
      if (existingWindow?.id) {
        await chrome.windows.update(existingWindow.id, { focused: true });
        return existingWindow;
      }
    } catch {
      await chrome.storage.local.remove(CHATGPT_WINDOW_KEY);
    }
  }

  try {
    const popupWindow = await chrome.windows.create({
      url,
      type: "popup",
      width: 540,
      height: 820,
      focused: true
    });

    if (popupWindow?.id) {
      await chrome.storage.local.set({ [CHATGPT_WINDOW_KEY]: popupWindow.id });
    }

    return popupWindow;
  } catch (error) {
    console.error("[GPT BG] Error creating popup:", error);

    const normalWindow = await chrome.windows.create({
      url,
      width: 540,
      height: 820,
      focused: true
    });

    if (normalWindow?.id) {
      await chrome.storage.local.set({ [CHATGPT_WINDOW_KEY]: normalWindow.id });
    }

    return normalWindow;
  }
}

async function waitForChatgptTab(windowId) {
  if (!windowId) {
    return null;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    if (tab?.id) {
      return tab;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return null;
}

async function waitForTabReady(tabId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === "complete") {
        return;
      }
    } catch {
      // Keep waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function injectTextIntoChatgptTab(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text],
    func: async (value) => {
      const selectors = [
        'textarea[placeholder*="Message"]',
        'textarea',
        '[contenteditable="true"]',
        'div[role="textbox"]'
      ];

      const waitForComposer = async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const composer = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
          if (composer) {
            return composer;
          }

          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return null;
      };

      const composer = await waitForComposer();
      if (!composer) {
        throw new Error("ChatGPT composer not found.");
      }

      composer.focus();

      if (composer instanceof HTMLTextAreaElement) {
        const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        nativeValueSetter?.call(composer, value);
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        return;
      }

      if (composer instanceof HTMLInputElement) {
        const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        nativeValueSetter?.call(composer, value);
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        return;
      }

      if (composer.isContentEditable) {
        composer.textContent = value;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        return;
      }

      throw new Error("Unsupported ChatGPT composer.");
    }
  });
}

async function injectImageIntoChatgptTab(tabId, dataUrl) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [dataUrl],
    func: async (value) => {
      const selectors = [
        'textarea[placeholder*="Message"]',
        'textarea',
        '[contenteditable="true"]',
        'div[role="textbox"]'
      ];

      const waitForComposer = async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const composer = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
          if (composer) {
            return composer;
          }

          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return null;
      };

      const composer = await waitForComposer();
      if (!composer) {
        throw new Error("ChatGPT composer not found.");
      }

      composer.focus();
      const response = await fetch(value);
      const blob = await response.blob();
      const file = new File([blob], "screenshot.png", { type: "image/png" });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });

      composer.dispatchEvent(pasteEvent);
      document.dispatchEvent(pasteEvent);
    }
  });
}

async function sendImageToChatgpt(dataUrl) {
  if (!dataUrl) {
    throw new Error("Missing image data.");
  }

  const popupWindow = await openOrFocusChatgptPopup("https://chatgpt.com/");
  const tab = await waitForChatgptTab(popupWindow?.id);
  if (!tab?.id) {
    throw new Error("Unable to open ChatGPT window.");
  }

  await waitForTabReady(tab.id);
  await injectImageIntoChatgptTab(tab.id, dataUrl);
}

async function captureVisibleTabForActiveBrowserWindow(preferredWindowId) {
  if (typeof preferredWindowId === "number") {
    try {
      return await chrome.tabs.captureVisibleTab(preferredWindowId, { format: "png" });
    } catch {
      // Fall through.
    }
  }

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const focusedWindow = windows.find((window) => window.focused) || windows[0];
  if (!focusedWindow?.id) {
    throw new Error("No browser window found to capture.");
  }

  return chrome.tabs.captureVisibleTab(focusedWindow.id, { format: "png" });
}

async function cropCapturedRegion(dataUrl, rect, viewportWidth, viewportHeight) {
  if (!dataUrl || !rect || !viewportWidth || !viewportHeight) {
    return dataUrl;
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const image = await createImageBitmap(blob);
  const scaleX = image.width / viewportWidth;
  const scaleY = image.height / viewportHeight;

  const cropX = Math.max(0, Math.round(rect.x * scaleX));
  const cropY = Math.max(0, Math.round(rect.y * scaleY));
  const cropWidth = Math.max(1, Math.round(rect.width * scaleX));
  const cropHeight = Math.max(1, Math.round(rect.height * scaleY));

  const canvas = new OffscreenCanvas(cropWidth, cropHeight);
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(croppedBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to convert image."));
    reader.readAsDataURL(blob);
  });
}