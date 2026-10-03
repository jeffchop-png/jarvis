const canvas = document.querySelector("#orb");
const context = canvas.getContext("2d");
const statusLine = document.querySelector("#status");
const systemState = document.querySelector("#system-state");
const transcriptLine = document.querySelector("#transcript");
const answerLine = document.querySelector("#answer");
const voiceToggle = document.querySelector("#voice-toggle");
const manualToggle = document.querySelector("#manual-toggle");
const manualInputWrap = document.querySelector("#manual-input-wrap");
const manualInput = document.querySelector("#manual-input");
const manualSubmit = document.querySelector("#manual-submit");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyInput = document.querySelector("#api-key");
const apiKeyStatus = document.querySelector("#api-key-status");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const conversation = [];
const isExtensionContext = typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.sendMessage;
const apiKeyStorageName = "jarvisGeminiApiKey";

const particleCount = 520;
const particles = Array.from({ length: particleCount }, (_, index) => {
  const y = 1 - (index / (particleCount - 1)) * 2;
  const radius = Math.sqrt(1 - y * y);
  const angle = Math.PI * (3 - Math.sqrt(5)) * index;
  return {
    x: Math.cos(angle) * radius,
    y,
    z: Math.sin(angle) * radius,
    phase: Math.random() * Math.PI * 2,
    size: 0.45 + Math.random() * 1.25
  };
});

let width = 0;
let height = 0;
let yaw = 0;
let pitch = 0.15;
let zoom = 1;
let spread = 1;
let pointerStart = null;
let dragged = false;
let recognition;
let listening = false;
let recognitionError = false;
let responding = false;

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    console.warn("Microphone permission unavailable:", error);
    return false;
  }
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const fallbackWidth = 360;
  const fallbackHeight = 360;

  width = bounds.width > 0 ? bounds.width : fallbackWidth;
  height = bounds.height > 0 ? bounds.height : fallbackHeight;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function renderOrb(time) {
  context.clearRect(0, 0, width, height);
  if (!width || !height) return requestAnimationFrame(renderOrb);

  const radius = Math.min(width, height) * 0.39 * zoom;
  const centerX = width / 2;
  const centerY = height / 2;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const projected = particles.map((particle) => {
    const spreadScale = spread * (1 + Math.sin(time * 0.0006 + particle.phase) * 0.012);
    const x = particle.x * spreadScale;
    const y = particle.y * spreadScale;
    const z = particle.z * spreadScale;
    const rotatedX = x * cosYaw - z * sinYaw;
    const rotatedZ = x * sinYaw + z * cosYaw;
    const rotatedY = y * cosPitch - rotatedZ * sinPitch;
    const depth = y * sinPitch + rotatedZ * cosPitch;
    const perspective = 1.35 / (1.35 - depth * 0.24);
    return {
      x: centerX + rotatedX * radius * perspective,
      y: centerY + rotatedY * radius * perspective,
      z: depth,
      size: particle.size * perspective,
      alpha: 0.2 + ((depth + 1) / 2) * 0.75
    };
  });

  const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.25);
  glow.addColorStop(0, listening ? "rgba(5, 142, 184, 0.15)" : "rgba(5, 111, 151, 0.12)");
  glow.addColorStop(1, "rgba(5, 30, 46, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const linkDistance = Math.max(9, radius * 0.105);
  const cells = new Map();
  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const cellX = Math.floor(point.x / linkDistance);
    const cellY = Math.floor(point.y / linkDistance);
    const key = `${cellX},${cellY}`;
    const cell = cells.get(key);
    if (cell) cell.push(index);
    else cells.set(key, [index]);
  }

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const cellX = Math.floor(point.x / linkDistance);
    const cellY = Math.floor(point.y / linkDistance);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nearby = cells.get(`${cellX + offsetX},${cellY + offsetY}`);
        if (!nearby) continue;
        for (const next of nearby) {
          if (next <= index) continue;
          const other = projected[next];
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          const distance = Math.hypot(dx, dy);
          if (distance < linkDistance && Math.abs(point.z - other.z) < 0.33) {
            context.strokeStyle = `rgba(37, 197, 233, ${0.12 * (1 - distance / linkDistance)})`;
            context.lineWidth = 0.55;
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(other.x, other.y);
            context.stroke();
          }
        }
      }
    }
  }

  for (const point of projected) {
    context.beginPath();
    context.arc(point.x, point.y, Math.max(0.55, point.size), 0, Math.PI * 2);
    context.fillStyle = `rgba(${Math.round(92 + point.alpha * 85)}, ${Math.round(190 + point.alpha * 60)}, 255, ${point.alpha})`;
    context.fill();
  }
  if (!dragged && !listening) yaw += 0.0011;
  requestAnimationFrame(renderOrb);
}

function adjustOrb(event) {
  if (!event.cancelable) return;
  event.preventDefault();
  const direction = Math.sign(event.deltaY);
  zoom = Math.min(1.55, Math.max(0.62, zoom - direction * 0.055));
  spread = Math.min(1.75, Math.max(0.66, spread - direction * 0.07));
}

canvas.addEventListener("wheel", adjustOrb, { passive: false });
canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
  dragged = false;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 14) dragged = true;
  if (dragged) {
    yaw += dx * 0.008;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + dy * 0.008));
    pointerStart = { x: event.clientX, y: event.clientY };
  }
});
canvas.addEventListener("pointerup", () => {
  if (!dragged) toggleListening();
  pointerStart = null;
  window.setTimeout(() => { dragged = false; }, 0);
});
canvas.addEventListener("pointercancel", () => {
  pointerStart = null;
  dragged = false;
});
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleListening();
  }
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
requestAnimationFrame(renderOrb);

if (!SpeechRecognition) {
  systemState.textContent = "VOICE UNAVAILABLE";
  statusLine.textContent = "THIS BROWSER DOES NOT SUPPORT VOICE INPUT";
  answerLine.textContent = "Try Chrome to use the built-in speech recognition. You can still rotate and reshape the orb.";
} else {
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => setListening(true);
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    if (result.isFinal && result[0].transcript.trim()) {
      processVoiceInput(result[0].transcript.trim());
    }
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      recognitionError = true;
      setListening(false);
      systemState.textContent = "MICROPHONE PERMISSION";
      statusLine.textContent = "MICROPHONE ACCESS IS BLOCKED";
      answerLine.textContent = "Allow microphone access in your browser, then tap the orb again or use the message box below.";
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      recognitionError = true;
      setListening(false);
      systemState.textContent = "VOICE ERROR";
      statusLine.textContent = "VOICE INPUT STOPPED";
      answerLine.textContent = `Speech recognition stopped: ${event.error}. You can still use the message box below.`;
    }
  };
  recognition.onend = () => {
    if (listening && !recognitionError && !responding) {
      try {
        recognition.start();
      } catch (error) {
        recognitionError = true;
        setListening(false);
        showError("Voice recognition could not restart", error);
      }
    } else if (!responding) {
      setListening(false);
    }
  };
}

voiceToggle.addEventListener("click", async () => {
  if (isExtensionContext) {
    await toggleListening();
    return;
  }
  if (listening) {
    stopListening();
    return;
  }
  if (SpeechRecognition) {
    await toggleListening();
  } else {
    answerLine.textContent = "Voice input is unavailable in this browser. You can still type me a message below.";
  }
});

function toggleManualInput(forceOpen) {
  const shouldShow = typeof forceOpen === "boolean" ? forceOpen : manualInputWrap.classList.contains("hidden");
  manualInputWrap.classList.toggle("hidden", !shouldShow);
  manualToggle.textContent = shouldShow ? "Hide messages" : "Type a message";
  manualToggle.setAttribute("aria-expanded", String(shouldShow));
  if (shouldShow) {
    manualInput.focus();
  }
}

manualToggle.addEventListener("click", () => {
  toggleManualInput();
});

if (!manualInputWrap.classList.contains("hidden")) {
  manualToggle.textContent = "Hide messages";
  manualToggle.setAttribute("aria-expanded", "true");
}

manualSubmit.addEventListener("click", () => {
  const text = manualInput.value.trim();
  if (!text) return;
  manualInput.value = "";
  processVoiceInput(text);
});

manualInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    manualSubmit.click();
  }
});

apiKeyStatus.textContent = localStorage.getItem(apiKeyStorageName)
  ? "A Gemini API key is saved in this browser."
  : "Get a key from Google AI Studio. It stays in this browser and is sent directly to Google.";
apiKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;
  localStorage.setItem(apiKeyStorageName, apiKey);
  apiKeyInput.value = "";
  apiKeyStatus.textContent = "API key saved in this browser. You can now have a conversation.";
});

if (!isExtensionContext) {
  systemState.textContent = "BROWSER MODE";
  statusLine.textContent = "READY TO CHAT";
  answerLine.textContent = "Hello. I'm here. Just talk to me, or ask whenever you'd like to know something.";
}

function calculate(expression) {
  if (expression.length > 100) return null;
  let index = 0;

  function skipSpaces() {
    while (expression[index] === " ") index += 1;
  }

  function parseNumber() {
    skipSpaces();
    if (expression[index] === "(") {
      index += 1;
      const value = parseExpression();
      skipSpaces();
      if (expression[index] !== ")") throw new Error("Missing closing parenthesis");
      index += 1;
      return value;
    }
    const start = index;
    while (/[0-9.]/.test(expression[index] || "")) index += 1;
    if (start === index) throw new Error("Expected a number");
    const value = Number(expression.slice(start, index));
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  }

  function parseFactor() {
    skipSpaces();
    if (expression[index] === "+" || expression[index] === "-") {
      const sign = expression[index++] === "-" ? -1 : 1;
      return sign * parseFactor();
    }
    let value = parseNumber();
    while (true) {
      skipSpaces();
      const operator = expression[index];
      if (operator !== "*" && operator !== "/" && operator !== "%") break;
      index += 1;
      const right = parseFactor();
      if ((operator === "/" || operator === "%") && right === 0) throw new Error("Division by zero");
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseFactor();
    while (true) {
      skipSpaces();
      const operator = expression[index];
      if (operator !== "+" && operator !== "-") break;
      index += 1;
      const right = parseFactor();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  try {
    const value = parseExpression();
    skipSpaces();
    return index === expression.length && Number.isFinite(value) ? Number(value.toPrecision(12)) : null;
  } catch {
    return null;
  }
}

function normalizeWebUrl(target) {
  const candidate = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".") || !["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function toggleListening() {
  if (!recognition) {
    systemState.textContent = "VOICE UNAVAILABLE";
    statusLine.textContent = "THIS BROWSER DOES NOT SUPPORT VOICE INPUT";
    answerLine.textContent = "Voice input is unavailable in this browser. You can still type a command below.";
    return;
  }
  recognitionError = false;
  if (listening) {
    listening = false;
    recognition.stop();
    setListening(false);
    return;
  }

  const permissionGranted = await ensureMicrophonePermission();
  if (!permissionGranted) {
    statusLine.textContent = "MICROPHONE ACCESS REQUIRED";
    systemState.textContent = "WAITING FOR PERMISSION";
    answerLine.textContent = "Please allow microphone access in this browser, then tap the orb again or use the message box below.";
    return;
  }

  statusLine.textContent = "REQUESTING MICROPHONE ACCESS";
  systemState.textContent = "CONNECTING";
  try {
    recognition.start();
  } catch (error) {
    setListening(false);
    showError("Voice recognition could not start", error);
  }
}

function cleanCommandText(text) {
  return String(text || "")
    .trim()
    .replace(/^jarvis\s*[,\-!:.]*\s*/i, "")
    .trim();
}

async function processVoiceInput(text) {
  const cleanText = cleanCommandText(text);
  transcriptLine.textContent = `YOU  /  ${cleanText || text}`;
  statusLine.textContent = "THINKING";
  systemState.textContent = "PROCESSING";
  answerLine.textContent = "Let me think that through…";
  responding = true;
  if (listening && recognition) recognition.stop();
  conversation.push({ role: "user", text: cleanText || text });

  try {
    if (!isExtensionContext) {
      const response = await browserFallbackReply(cleanText || text);
      conversation.push({ role: "assistant", text: response });
      answerLine.textContent = response;
      statusLine.textContent = "JARVIS";
      systemState.textContent = listening ? "LISTENING" : "READY";
      speak(response);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "voice-command",
      text,
      history: conversation.slice(-12),
      apiKey: localStorage.getItem(apiKeyStorageName)
    });
    if (!response || typeof response.text !== "string") {
      throw new Error("The assistant returned an invalid response.");
    }
    conversation.push({ role: "assistant", text: response.text });
    answerLine.textContent = response.text;
    statusLine.textContent = "JARVIS";
    systemState.textContent = listening ? "LISTENING" : "READY";
    speak(response.text);
  } catch (error) {
    responding = false;
    showError("I couldn't reach the assistant", error);
    restartListening();
  }
}

async function browserFallbackReply(text) {
  const raw = cleanCommandText(text);
  if (!raw) return "I didn’t catch that. Please try again.";

  const normalized = raw.toLowerCase();
  if (/^(what time is it|tell me the time)\b/.test(normalized)) {
    return `It is ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}.`;
  }
  if (/^(what('s| is) the date|what day is it|tell me the date)\b/.test(normalized)) {
    return `Today is ${new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}.`;
  }
  if (/^(search for|google)\b/.test(normalized)) {
    const query = raw.replace(/^(search for|google)\s+/i, "").trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query || "")}`;
    window.open(url, "_blank", "noopener");
    return query ? `I opened a Google search for ${query}.` : "I opened a Google search page for you.";
  }
  if (/^open\s+/.test(normalized)) {
    const target = raw.replace(/^open\s+/i, "").trim();
    const url = normalizeWebUrl(target) || `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    window.open(url, "_blank", "noopener");
    return `I opened ${target || "that page"} for you.`;
  }
  const mathExpression = raw.match(/(?:calculate|what is|what's|solve|compute)\s+(.+)/i) ||
    (raw.match(/^[0-9\s().+\-*/%]+$/) ? [raw, raw] : null);
  if (mathExpression) {
    const expression = (mathExpression[1] || mathExpression[0]).trim();
    const result = calculate(expression.replace(/^=\s?/, ""));
    if (result !== null) return `That comes to ${result}.`;
  }

  if (normalized.includes("tab") || normalized.includes("browser")) {
    return "This browser mode cannot directly manage Chrome tabs or the extension panel on mobile. It works best for chat, quick searches, and simple local voice commands.";
  }

  return requestGeminiReply(raw, conversation, localStorage.getItem(apiKeyStorageName));
}

async function requestGeminiReply(text, history, apiKey) {
  if (!apiKey) {
    throw new Error("Connect Gemini first: open “Connect conversational AI” and add a Google AI Studio API key.");
  }
  const contents = history
    .filter((turn) => ["user", "assistant"].includes(turn.role) && typeof turn.text === "string")
    .slice(-12)
    .map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.text.slice(0, 4000) }]
    }));
  if (contents.at(-1)?.role !== "user" || contents.at(-1)?.parts[0].text !== text) {
    contents.push({ role: "user", parts: [{ text: text.slice(0, 4000) }] });
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "You are Jarvis, a thoughtful, warm, natural conversational assistant. Respond to the person's actual meaning, use the conversation context, ask a follow-up only when useful, and avoid canned openings or repetitive phrasing. Be honest when uncertain. Keep spoken answers concise but provide detail when asked."
        }]
      },
      contents,
      generationConfig: { temperature: 0.85, maxOutputTokens: 700 }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini returned HTTP ${response.status}. Check the API key and Google AI Studio access.`);
  }
  const answer = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!answer) {
    throw new Error("Gemini did not return a reply. Try rephrasing your message.");
  }
  return answer;
}

async function summarizeGeneralQuestion(question) {
  const [wikipediaResult, duckDuckGoResult] = await Promise.allSettled([
    searchWikipedia(question),
    searchDuckDuckGo(question)
  ]);

  const parts = [];
  if (wikipediaResult.status === "fulfilled" && wikipediaResult.value) parts.push(wikipediaResult.value);
  if (duckDuckGoResult.status === "fulfilled" && duckDuckGoResult.value) parts.push(duckDuckGoResult.value);

  if (parts.length > 0) {
    return paraphraseFindings(parts);
  }

  const query = encodeURIComponent(question);
  window.open(`https://www.google.com/search?q=${query}`, "_blank", "noopener");
  return `I searched the web for “${question}” and opened the results for you. Ask me a more direct question, and I’ll summarize the answer for you.`;
}

function paraphraseFindings(parts) {
  const sources = parts.map((part) => part.match(/^(Wikipedia|DuckDuckGo):/i)?.[1]).filter(Boolean);
  const text = parts
    .map((part) => part
      .replace(/^(Wikipedia|DuckDuckGo):\s*/i, "")
      .replace(/\s*\(https?:\/\/[^)]+\)/gi, "")
      .replace(/https?:\/\/\S+/gi, "")
      .trim())
    .filter(Boolean)
    .join(" ");
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  let summary = sentences.slice(0, 3).join(" ").trim();
  if (summary.length > 480) {
    summary = `${summary.slice(0, 477).replace(/\s+\S*$/, "")}…`;
  }
  const sourceNames = [...new Set(sources)].join(" and ");
  return summary
    ? `Here's the short version${sourceNames ? `, based on ${sourceNames}` : ""}: ${summary}`
    : "I found a couple of useful sources, but they didn't give me a clear summary.";
}

async function searchWikipedia(question) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: question,
    gsrlimit: "2",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exchars: "500",
    format: "json",
    origin: "*"
  });

  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const data = await response.json();
  const pages = Object.values(data.query?.pages || {});
  const text = pages
    .filter((page) => page.extract)
    .slice(0, 2)
    .map((page) => `${page.title}: ${page.extract}`)
    .join(" ");
  return text ? `Wikipedia: ${text}` : "";
}

async function searchDuckDuckGo(question) {
  const params = new URLSearchParams({
    q: question,
    format: "json",
    no_html: "1",
    skip_disambig: "1"
  });

  const response = await fetch(`https://api.duckduckgo.com/?${params}`);
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);
  const data = await response.json();
  const text = [data.Answer, data.AbstractText].filter((item) => typeof item === "string" && item.trim()).slice(0, 2).join(" ");
  return text ? `DuckDuckGo: ${text}${data.AbstractURL ? ` (${data.AbstractURL})` : ""}` : "";
}

function stopListening() {
  if (recognition) {
    recognition.stop();
  }
  setListening(false);
  statusLine.textContent = "VOICE PAUSED";
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    answerLine.textContent += " Speech playback is unavailable in this browser.";
    responding = false;
    restartListening();
    return;
  }
  window.speechSynthesis.cancel();
  const spokenText = text.replace(/https?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
  const utterance = new SpeechSynthesisUtterance(spokenText);
  const voices = window.speechSynthesis.getVoices();
  const britishVoices = voices.filter((voice) => /^en-GB$/i.test(voice.lang));
  utterance.voice = britishVoices.find((voice) => /\bmale\b/i.test(voice.name)) ||
    britishVoices[0] ||
    voices.find((voice) => /^en-/i.test(voice.lang)) ||
    null;
  utterance.rate = 0.92;
  utterance.pitch = 0.84;
  utterance.onend = () => {
    responding = false;
    restartListening();
  };
  utterance.onerror = (event) => {
    responding = false;
    systemState.textContent = "READY";
    statusLine.textContent = "SPEECH PLAYBACK UNAVAILABLE";
    answerLine.textContent += ` Speech playback failed: ${event.error}.`;
    restartListening();
  };
  window.speechSynthesis.speak(utterance);
}

function restartListening() {
  if (!listening || recognitionError) return;
  try {
    recognition.start();
  } catch (error) {
    recognitionError = true;
    setListening(false);
    showError("Voice recognition could not restart", error);
  }
}

function setListening(active) {
  listening = active;
  document.body.classList.toggle("is-listening", active);
  systemState.textContent = active ? "LISTENING" : "READY";
  if (active) statusLine.textContent = "LISTENING — TAP THE ORB TO STOP";
  else if (statusLine.textContent.startsWith("LISTENING")) statusLine.textContent = "JARVIS IS READY";
}

function showError(message, error) {
  console.error(message, error);
  systemState.textContent = "ACTION FAILED";
  statusLine.textContent = message.toUpperCase();
  answerLine.textContent = `${message}: ${error.message}`;
}
