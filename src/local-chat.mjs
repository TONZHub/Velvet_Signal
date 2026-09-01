import { createInterface as createReadlineInterface } from "node:readline/promises";

export const DEFAULT_CHAT_HISTORY_MESSAGES = 24;

function line(output, value = "") {
  output.write(`${value}\n`);
}

function statusLine(status = {}) {
  const active = Number.isInteger(status.activePatchCount)
    ? status.activePatchCount
    : 0;
  return `Active patches: ${active}`;
}

export async function runLocalChat(options = {}) {
  if (typeof options.turn !== "function") {
    throw new Error("runLocalChat requires a turn(message, history) function.");
  }

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const createInterface = options.createInterface ?? createReadlineInterface;
  const modelName = String(options.modelName ?? "local model");
  const historyLimit = Number.isInteger(options.historyLimit)
    ? Math.max(2, options.historyLimit)
    : DEFAULT_CHAT_HISTORY_MESSAGES;
  const getStatus = typeof options.getStatus === "function"
    ? options.getStatus
    : async () => ({ activePatchCount: 0 });

  const rl = createInterface({ input, output });
  const history = [];

  line(output, "Velvet Signal Local Chat");
  line(output, `Model: ${modelName}`);
  line(output, statusLine(await getStatus()));
  line(output, "Every turn passes through Velvet Signal retrieval before Ollama.");
  line(output, "Commands: /help, /status, /clear, /exit");

  try {
    while (true) {
      const raw = await rl.question("\nYou > ");
      const message = String(raw ?? "").trim();
      if (!message) continue;

      const command = message.toLowerCase();
      if (command === "/exit" || command === "/quit") {
        line(output, "\nVelvet Signal chat closed.");
        break;
      }
      if (command === "/help") {
        line(output, "\n/help   Show commands");
        line(output, "/status Show active local patch count");
        line(output, "/clear  Clear conversational history only");
        line(output, "/exit   Leave chat");
        continue;
      }
      if (command === "/status") {
        line(output, `\n${statusLine(await getStatus())}`);
        continue;
      }
      if (command === "/clear") {
        history.length = 0;
        line(output, "\nConversation history cleared. Released patches are unchanged.");
        continue;
      }

      const result = await options.turn(message, [...history]);
      const answer = String(result?.answer ?? result ?? "").trim();
      line(output, `\n${modelName} > ${answer || "(no response)"}`);
      if (result?.diagnostic) {
        line(errorOutput, result.diagnostic);
      }

      history.push(
        { role: "user", content: message },
        { role: "assistant", content: answer },
      );
      if (history.length > historyLimit) {
        history.splice(0, history.length - historyLimit);
      }
    }
  } finally {
    rl.close();
  }
}
