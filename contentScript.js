(() => {
  if (window.__gptChromeExtensionLoaded) {
    return;
  }

  window.__gptChromeExtensionLoaded = true;

  const isChatgpt = /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(location.hostname);

  if (isChatgpt) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "insert-text") {
        insertTextIntoComposer(message.text || "");
      }

      if (message?.type === "paste-image") {
        pasteImageIntoComposer(message.dataUrl || "");
      }
    });
    return;
  }

  installSelectionOverlay();
  installPageCaptureBridge();

  function installSelectionOverlay() {
    let selectionTimer = null;
    let selectedText = "";

    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.zIndex = "2147483647";
    menu.style.display = "none";
    menu.style.gap = "8px";
    menu.style.padding = "8px";
    menu.style.border = "1px solid #ff8a00";
    menu.style.borderRadius = "18px";
    menu.style.background = "rgba(10, 10, 10, 0.96)";
    menu.style.boxShadow = "0 10px 30px rgba(255, 138, 0, 0.25)";
    menu.style.backdropFilter = "blur(12px)";
    menu.style.flexWrap = "nowrap";
    menu.style.width = "max-content";
    menu.style.whiteSpace = "nowrap";
    document.documentElement.appendChild(menu);

    const buttons = [
      { label: "Explain", prompt: "Explain:\n" },
      { label: "Summarize", prompt: "Summarize:\n" },
      { label: "Translate", prompt: "Translate to English:\n" }
    ];

    buttons.forEach(({ label, prompt }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.padding = "10px 12px";
      button.style.border = "1px solid rgba(255, 138, 0, 0.35)";
      button.style.borderRadius = "999px";
      button.style.background = "rgba(255, 138, 0, 0.12)";
      button.style.color = "#ffcf91";
      button.style.cursor = "pointer";
      button.style.font = "600 12px/1.2 Segoe UI, system-ui, sans-serif";
      button.style.letterSpacing = "0.02em";
      button.style.whiteSpace = "nowrap";
      button.addEventListener("mousedown", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!selectedText) {
          return;
        }

        try {
          await chrome.runtime.sendMessage({ type: "open-chatgpt-with-text", text: `${prompt}${selectedText}` });
        } catch (error) {
          console.error("[GPT Ext] Error opening ChatGPT:", error);
        }

        hide();
      });
      menu.appendChild(button);
    });

    const hide = () => {
      menu.style.display = "none";
    };

    const scheduleUpdate = () => {
      if (selectionTimer) {
        clearTimeout(selectionTimer);
      }

      selectionTimer = setTimeout(update, 140);
    };

    const update = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!selection || selection.isCollapsed || !text) {
        selectedText = "";
        hide();
        return;
      }

      selectedText = text;

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        hide();
        return;
      }

      menu.style.display = "inline-flex";
      menu.style.visibility = "hidden";
      menu.style.left = "12px";
      menu.style.top = "12px";

      const menuHeight = menu.offsetHeight || 0;
      const aboveTop = rect.top - menuHeight - 12;
      const clampedTop = Math.max(12, aboveTop);

      menu.style.top = `${clampedTop}px`;
      menu.style.left = `${Math.max(12, rect.left)}px`;
      menu.style.visibility = "visible";
    };

    document.addEventListener("selectionchange", scheduleUpdate);
    document.addEventListener("mouseup", scheduleUpdate, true);
    document.addEventListener("keyup", scheduleUpdate, true);
    document.addEventListener("mousedown", (event) => {
      if (!menu.contains(event.target)) {
        hide();
      }
    }, true);
    document.addEventListener("scroll", hide, true);

    menu.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function installPageCaptureBridge() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "start-page-capture") {
        return false;
      }

      beginPageCapture()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    });
  }

  async function beginPageCapture() {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483646";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.25)";
    overlay.style.cursor = "crosshair";
    document.documentElement.appendChild(overlay);

    const guide = document.createElement("div");
    guide.textContent = "Drag to select area";
    guide.style.position = "fixed";
    guide.style.top = "20px";
    guide.style.left = "20px";
    guide.style.color = "#fff";
    guide.style.fontSize = "14px";
    guide.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    guide.style.padding = "8px 12px";
    guide.style.borderRadius = "4px";
    guide.style.zIndex = "2147483647";
    document.documentElement.appendChild(guide);

    const selectionBox = document.createElement("div");
    selectionBox.style.position = "fixed";
    selectionBox.style.border = "2px solid #ff8a00";
    selectionBox.style.backgroundColor = "rgba(255, 138, 0, 0.1)";
    selectionBox.style.zIndex = "2147483647";
    selectionBox.style.display = "none";
    document.documentElement.appendChild(selectionBox);

    const state = {
      dragging: false,
      startX: 0,
      startY: 0,
      active: true
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const cleanup = () => {
      if (!state.active) {
        return;
      }

      state.active = false;
      overlay.remove();
      guide.remove();
      selectionBox.remove();
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };

    const onMouseMove = (event) => {
      if (!state.dragging) {
        return;
      }

      event.preventDefault();

      const currentX = clamp(event.clientX, 0, window.innerWidth);
      const currentY = clamp(event.clientY, 0, window.innerHeight);

      const x = Math.min(state.startX, currentX);
      const y = Math.min(state.startY, currentY);
      const width = Math.abs(currentX - state.startX);
      const height = Math.abs(currentY - state.startY);

      selectionBox.style.left = `${x}px`;
      selectionBox.style.top = `${y}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;
      selectionBox.style.display = width > 10 && height > 10 ? "block" : "none";
    };

    const onMouseUp = async (event) => {
      if (!state.dragging) {
        return;
      }

      event.preventDefault();
      state.dragging = false;

      const currentX = clamp(event.clientX, 0, window.innerWidth);
      const currentY = clamp(event.clientY, 0, window.innerHeight);

      const x = Math.min(state.startX, currentX);
      const y = Math.min(state.startY, currentY);
      const width = Math.abs(currentX - state.startX);
      const height = Math.abs(currentY - state.startY);

      cleanup();

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      if (width < 10 || height < 10) {
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "capture-page-region",
        rect: { x, y, width, height },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      });

      if (response?.ok && response.dataUrl) {
        await chrome.runtime.sendMessage({ type: "send-image-to-chatgpt", dataUrl: response.dataUrl });
      }
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        state.dragging = false;
        cleanup();
      }
    };

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keydown", onKeyDown, true);

    overlay.addEventListener("mousedown", (event) => {
      event.preventDefault();
      state.dragging = true;
      state.startX = clamp(event.clientX, 0, window.innerWidth);
      state.startY = clamp(event.clientY, 0, window.innerHeight);
      selectionBox.style.display = "none";
    });
  }

  async function insertTextIntoComposer(text) {
    const selectors = [
      'textarea[placeholder*="Message"]',
      'textarea',
      '[contenteditable="true"]',
      'div[role="textbox"]'
    ];

    for (const selector of selectors) {
      const composer = document.querySelector(selector);
      if (!composer) {
        continue;
      }

      composer.focus();

      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        nativeValueSetter?.call(composer, text);
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return;
      }

      if (composer.isContentEditable) {
        composer.textContent = text;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return;
      }
    }

    throw new Error("ChatGPT composer not found.");
  }

  function pasteImageIntoComposer(dataUrl) {
    const pasteImage = async () => {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], "screenshot.png", { type: "image/png" });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const pasteEvent = new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });

        document.dispatchEvent(pasteEvent);

        const activeElement = document.activeElement;
        if (activeElement) {
          activeElement.dispatchEvent(pasteEvent);
        }
      } catch (error) {
        console.error("[GPT Ext] Error pasting image:", error);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", pasteImage);
    } else {
      pasteImage();
    }
  }
})();