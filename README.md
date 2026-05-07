# GPT Chrome Extension

A Chrome MV3 extension with three core tools:

- A side panel for chatting with GPT from any tab.
- A selection overlay that surfaces the options - "Explain", "Summarize" and "Translate" actions when you highlight text.
- A visible-page screenshot capture flow with a crop box and handoff toward ChatGPT.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this folder.

## Notes

- The extension uses ChatGPT web pages rather than the OpenAI API.
- Screenshot upload is implemented as a best-effort browser-side handoff using clipboard and ChatGPT tab messaging.
- The selection bubble appears on non-ChatGPT pages; the side panel also exposes the same action.
