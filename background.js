chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.sidePanel.setOptions({ path: "panel.html", enabled: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.sidePanel.setOptions({ path: "panel.html", enabled: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "voice-command" || typeof message.text !== "string") {
    return false;
  }

  handleCommand(message.text, Array.isArray(message.history) ? message.history : [], message.apiKey)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("Jarvis command failed:", error);
      sendResponse({ text: `I couldn't complete that request: ${error.message}` });
    });

  return true;
});

function stripJarvisPrefix(text) {
  return text
    .trim()
    .replace(/^jarvis\s*[,\-!:.]*\s*/i, "")
    .trim();
}

async function handleCommand(rawText, history, apiKey) {
  const text = stripJarvisPrefix(rawText);
  const normalized = text.toLowerCase();
  if (!text) return { text: "I didn't catch that. Say it again when you're ready." };

  if (/^(what |which )?(tabs|pages) (are )?(open|opened)|^list (my )?(tabs|open tabs)/.test(normalized)) {
    return { text: await describeTabs() };
  }

  const switchMatch = normalized.match(/^(?:switch to|go to|activate) (?:the )?(.+?)(?: tab)?$/);
  if (switchMatch) {
    return { text: await activateTab(switchMatch[1]) };
  }

  const closeMatch = normalized.match(/^close (?:the )?(.+?) tab$/);
  if (closeMatch && !["current", "this", "active"].includes(closeMatch[1])) {
    return { text: await closeNamedTab(closeMatch[1]) };
  }
  if (/^(close|close this|close current|close this tab|close current tab)$/.test(normalized)) {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab?.id) return { text: "I couldn't find the current tab." };
    await chrome.tabs.remove(activeTab.id);
    return { text: "Closed the current tab." };
  }

  const searchMatch = text.match(/^(?:search(?: google)? for|google) (.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    await chrome.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
    });
    return { text: `Opened a Google search for ${query} in a new tab. Your current tab is still open.` };
  }

  const openMatch = text.match(/^open (.+)$/i);
  if (openMatch) {
    const target = openMatch[1].trim();
    const url = normalizeWebUrl(target);
    if (url) {
      await chrome.tabs.create({ url });
      return { text: `Opened ${target} in a new tab.` };
    }
    await chrome.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(target)}`
    });
    return { text: `I couldn't identify a website for ${target}, so I searched for it in a new tab.` };
  }

  return { text: await generateGeminiReply(text, history, apiKey) };
}

async function generateGeminiReply(text, history, apiKey) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
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
      "x-goog-api-key": apiKey.trim()
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

async function describeTabs() {
  const tabs = await chrome.tabs.query({});
  if (tabs.length === 0) return "There are no open tabs.";
  const names = tabs.map((tab, index) =>
    `${index + 1}: ${tab.title || tab.url || "Untitled"}${tab.active ? " (active)" : ""}`
  );
  return `You have ${tabs.length} tabs open. ${names.join(". ")}.`;
}

async function activateTab(query) {
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) =>
    (tab.title || "").toLowerCase().includes(query) ||
    (tab.url || "").toLowerCase().includes(query)
  );
  if (!match?.id) return `I couldn't find an open tab matching ${query}.`;
  if (match.windowId !== undefined) {
    await chrome.windows.update(match.windowId, { focused: true });
  }
  await chrome.tabs.update(match.id, { active: true });
  return `Switched to ${match.title || "that tab"}.`;
}

async function closeNamedTab(query) {
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) =>
    (tab.title || "").toLowerCase().includes(query) ||
    (tab.url || "").toLowerCase().includes(query)
  );
  if (!match?.id) return `I couldn't find an open tab matching ${query}.`;
  await chrome.tabs.remove(match.id);
  return `Closed ${match.title || "that tab"}.`;
}

async function answerQuestion(question, history) {
  let searchText = question;
  if (/^(tell me more|explain that|what about that|can you elaborate)\b/i.test(question)) {
    const previousQuestion = [...history].reverse().find((turn) =>
      turn.role === "user" && turn.text.toLowerCase() !== question.toLowerCase()
    );
    if (previousQuestion) searchText = previousQuestion.text;
  }

  const [wikipedia, duckDuckGo] = await Promise.allSettled([
    searchWikipedia(searchText),
    searchDuckDuckGo(searchText)
  ]);
  const parts = [];
  if (wikipedia.status === "fulfilled" && wikipedia.value) parts.push(wikipedia.value);
  if (duckDuckGo.status === "fulfilled" && duckDuckGo.value) parts.push(duckDuckGo.value);
  const failures = [wikipedia, duckDuckGo]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message || "unknown network error");

  if (parts.length === 0) {
    if (failures.length > 0) {
      throw new Error(`Knowledge sources are unavailable: ${failures.join("; ")}`);
    }
    return "I couldn't find a concise answer in Wikipedia or DuckDuckGo for that question. You can say “search for” and your topic to open Google in a new tab.";
  }
  const answer = paraphraseFindings(parts);
  const followUp = searchText !== question ? "Sure — here's a little more. " : "";
  const sourceNotice = failures.length
    ? ` I couldn't reach one of the sources this time.`
    : "";
  return `${followUp}${answer}${sourceNotice}`;
}

function paraphraseFindings(parts) {
  const sources = parts.map((part) => part.match(/^(Wikipedia|DuckDuckGo):/i)?.[1]).filter(Boolean);
  const text = parts
    .map((part) => part
      .replace(/^(Wikipedia|DuckDuckGo):\s*/i, "")
      .replace(/\s*\(source: https?:\/\/[^)]+\)/gi, "")
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
    gsrlimit: "3",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exchars: "650",
    format: "json",
    origin: "*"
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const data = await response.json();
  const pages = Object.values(data.query?.pages || {});
  const summaries = pages
    .filter((page) => page.extract)
    .slice(0, 2)
    .map((page) => `${page.title}: ${page.extract} (source: https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))})`);
  return summaries.length ? `Wikipedia: ${summaries.join(" ")}` : "";
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
  const text = [data.Answer, data.AbstractText, ...extractRelatedTopics(data.RelatedTopics)]
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, 2)
    .join(" ");
  return text ? `DuckDuckGo: ${text}${data.AbstractURL ? ` (source: ${data.AbstractURL})` : ""}` : "";
}

function extractRelatedTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics.flatMap((topic) => {
    if (typeof topic.Text === "string") return [topic.Text];
    return extractRelatedTopics(topic.Topics);
  });
}
