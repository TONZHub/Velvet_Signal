import { pathToFileURL } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { ollamaChat } from "./ollama.mjs";

const DEFAULT_ENDPOINT = "https://velvetsignal.lol/mcp";
const DEFAULT_PROMPT =
  "Use the available tools to list the Maker Edition issues, inspect maker-012, and explain its correction status. Do not claim that you approved or applied anything.";

function parseArguments(argv) {
  const options = { endpoint: process.env.VELVET_MCP_URL ?? DEFAULT_ENDPOINT };
  const prompt = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--model") options.model = argv[++index];
    else if (value === "--endpoint") options.endpoint = argv[++index];
    else if (value === "--max-tool-calls") {
      options.maxToolCalls = Number.parseInt(argv[++index], 10);
    } else prompt.push(value);
  }
  options.prompt = prompt.join(" ").trim() || DEFAULT_PROMPT;
  return options;
}

function ollamaTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

function toolArguments(call) {
  const value = call?.function?.arguments;
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`The local model supplied invalid JSON arguments for ${call?.function?.name ?? "a tool"}.`);
    }
  }
  return {};
}

function modelToolMessage(call, result) {
  const payload = result.structuredContent ?? result.content ?? result;
  return {
    role: "tool",
    tool_name: call.function.name,
    content: JSON.stringify(payload),
  };
}

export async function runLocalModelMcpDemo(options) {
  const client = options.client;
  const chat = options.chat ?? ollamaChat;
  const trace = options.trace ?? (() => {});
  const maxToolCalls = Number.isInteger(options.maxToolCalls)
    ? options.maxToolCalls
    : 6;
  const listing = await client.listTools();
  const tools = ollamaTools(listing.tools);
  trace({ type: "discovery", tools: listing.tools.map((tool) => tool.name) });

  const messages = [
    {
      role: "system",
      content:
        "You are a local model using Velvet Signal through an MCP-over-HTTP bridge to the site's WebMCP tool contract. Use tools when the user asks about the publication. Never describe inspection as approval, and never invent a signed delivery artifact.",
    },
    { role: "user", content: options.prompt },
  ];
  let callsMade = 0;

  while (callsMade < maxToolCalls) {
    const turn = await chat(messages, {
      model: options.model,
      tools,
      think: false,
      fetchImpl: options.fetchImpl,
      baseUrl: options.ollamaUrl,
    });
    const message = turn.message ?? turn.raw?.message ?? {
      role: "assistant",
      content: turn.content,
    };
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) {
      return {
        answer: String(message.content ?? "").trim(),
        callsMade,
        tools: listing.tools,
      };
    }
    messages.push(message);
    for (const call of calls) {
      if (callsMade >= maxToolCalls) break;
      const name = call?.function?.name;
      const args = toolArguments(call);
      trace({ type: "tool_call", name, arguments: args });
      const result = await client.callTool({ name, arguments: args });
      trace({ type: "tool_result", name, result });
      messages.push(modelToolMessage(call, result));
      callsMade += 1;
    }
  }
  throw new Error(`The local model exceeded the ${maxToolCalls}-call safety limit.`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!options.model && !process.env.OLLAMA_MODEL) {
    throw new Error("Set OLLAMA_MODEL or pass --model <tool-capable-ollama-model>.");
  }
  const client = new Client({
    name: "velvet-signal-local-model-proof",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(options.endpoint));
  try {
    await client.connect(transport);
    console.error(`[MCP] connected ${options.endpoint}`);
    const result = await runLocalModelMcpDemo({
      ...options,
      client,
      trace(event) {
        if (event.type === "discovery") {
          console.error(`[MCP] discovered ${event.tools.length} tools: ${event.tools.join(", ")}`);
        } else if (event.type === "tool_call") {
          console.error(`[LOCAL MODEL -> MCP] ${event.name} ${JSON.stringify(event.arguments)}`);
        } else {
          console.error(`[MCP -> LOCAL MODEL] ${event.name} returned`);
        }
      },
    });
    console.log(result.answer);
    console.error(`[PROOF] local model made ${result.callsMade} MCP tool call(s)`);
  } finally {
    await client.close();
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}


