# LeetSync-Mini

> **Last Updated:** 2026-08-28

A Chrome extension that automatically pushes your accepted LeetCode submissions to a GitHub repository.

## Features

- 🚀 Auto-syncs accepted LeetCode solutions to GitHub
- 🌐 Supports both `leetcode.com` and `leetcode.cn`
- 🔔 Browser notifications on successful push
- ⚙️ Easy configuration via popup UI

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the project folder.
5. The **LeetSync-Mini** extension icon will appear in your toolbar.

## Configuration

1. Click the extension icon in the toolbar.
2. Enter your **GitHub Personal Access Token** (needs `repo` scope).
3. Enter your **GitHub Username** and the **Repository Name** where solutions should be pushed.
4. Save the settings.

## How It Works

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) — permissions & entry points |
| `background.js` | Service worker — handles GitHub API calls & push logic |
| `content.js` | Content script — detects accepted submissions on LeetCode |
| `injected.js` | Injected into page main world — intercepts GraphQL responses |
| `popup.html` / `popup.js` | Extension popup UI for settings |

## Permissions

- **storage** — saves your GitHub credentials locally
- **scripting** — injects scripts into LeetCode pages
- **notifications** — alerts you when a solution is successfully pushed
- **Host permissions** — `leetcode.com`, `leetcode.cn`, `api.github.com`

## License

MIT
