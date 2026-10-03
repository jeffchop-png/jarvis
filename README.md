# Jarvis Voice Assistant

A Chrome Manifest V3 side-panel extension with an interactive particle orb and microphone button. Tap the orb or the button to start or stop voice listening. While the side panel stays open, you can switch browser tabs and continue giving voice commands.

## Publish the web app

This is a static site; it does not need a server or a port when hosted. To publish it on GitHub Pages:

1. Push the contents of this folder to a GitHub repository. The included workflow runs on `main`, `master`, and `jarvis-live`.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. The included workflow deploys the site whenever you push to either branch. Open the URL shown in the completed **Deploy to GitHub Pages** workflow to use Jarvis.

The site is served over HTTPS, which browsers require for microphone access. Conversation uses a small AI model running on the user's device: there is no AI account, API key, paid AI service, or usage bill. The model downloads the first time someone chats (hundreds of MB; Wi-Fi is recommended), and needs a browser/device with WebGPU support. Chat messages are processed locally. The user's internet provider may charge for data; no model download or inference is hosted or paid for by this project.

## Install the extension

After publishing, open `<your-pages-url>/install.html` for the guided install page. For a local preview only, run `python3 -m http.server 8000` from this folder and open <http://localhost:8000/install.html>.

The download is a ZIP package. Chrome does not install a ZIP directly: extract it, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the extracted folder containing `manifest.json`. Keep that folder in place while using the extension. Open Jarvis from Chrome's toolbar and allow microphone access when prompted.

To load the extension directly from this project without downloading the ZIP, use **Load unpacked** and choose this folder instead.

## Phone-friendly browser mode

This project is designed to work best on a Motorola or other Android phone as a browser app, not as a desktop Chrome extension. Android browsers cannot install unpacked extension bundles the same way a desktop browser does.

- Open the app in Chrome Beta on your phone.
- Tap the menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.
- Use the shortcut from your home screen to launch Jarvis more easily.
- If you want the desktop extension flow, use the computer instructions on the install page.

The simplest route for your phone is to open the mobile app page and install it as a shortcut instead of trying to use the unpacked extension flow.

In browser mode, Jarvis runs open-ended conversation on-device and keeps recent turns as context. The model and runtime are downloaded from public hosting the first time they are needed, so an internet connection and data may be used during setup; after that, inference is local. Conversation does not send prompts to an AI service. Speech recognition is provided by the browser and may send audio to the browser's configured speech service.

Speech recognition is supplied by the browser and may send audio to the browser's configured speech service. Listening starts only after tapping the orb or microphone button. Closing the side panel or browser stops the listening session.

## Conversation and voice

- “What tabs are open?”
- “Switch to [part of a tab title or website]”
- “Close [part of a tab title] tab”
- “Close this tab”
- “Search for [topic]” — opens Google in a new tab without replacing the current tab.
- “Open [website]”
- Chat naturally — statements get a conversational reply instead of triggering a web search.
- Ask questions and chat naturally — responses are generated on-device.

Spoken replies use the browser's available speech voices, preferring an English (UK) voice when one is installed, with a measured pace and lower pitch. The selected voice depends on your browser and device.

The extension can list, switch to, and close tabs across Chrome windows where it is enabled. The extension version does not use a paid AI API; open the web app for on-device AI conversation. It does not read private tab content, scrape Google results, or control tabs in other browser profiles.

## Knowledge and limitations

The on-device model can produce incomplete or incorrect replies, so verify important information independently with primary sources. Its quality and speed depend on the device. If WebGPU is unavailable, local AI conversation will not work on that device. Voice input depends on browser support and may send audio to the browser's configured speech service.
