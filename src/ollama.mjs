const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

function baseUrl(value) {
  return String(value ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
}

async function postJson(path, body, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl(options.baseUrl)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`Ollama ${path} failed: ${message}`);
  }
  return payload;
}

export async function ollamaEmbed(input, options = {}) {
  const values = Array.isArray(input) ? input : [input];
  const payload = await postJson(
    "/api/embed",
    {
      model: options.model ?? process.env.VELVET_EMBED_MODEL ?? "embeddinggemma",
      input: values,
      truncate: true,
    },
    options,
  );
  if (!Array.isArray(payload?.embeddings) || payload.embeddings.length !== values.length) {
    throw new Error("Ollama returned an invalid embeddings response.");
  }
  return payload.embeddings;
}

export async function ollamaChat(messages, options = {}) {
  const model = options.model ?? process.env.OLLAMA_MODEL;
  if (!model) throw new Error("Set OLLAMA_MODEL or pass --model <name>.");
  const payload = await postJson(
    "/api/chat",
    {
      model,
      messages,
      stream: false,
      ...(options.think === undefined ? {} : { think: options.think }),
    },
    options,
  );
  const content = payload?.message?.content;
  if (typeof content !== "string") throw new Error("Ollama returned no assistant message.");
  return { content, raw: payload };
}
