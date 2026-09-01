import assert from "node:assert/strict";
import test from "node:test";
import { runLocalChat } from "../src/local-chat.mjs";

function writer() {
  let text = "";
  return {
    write(value) {
      text += String(value);
    },
    text() {
      return text;
    },
  };
}

test("local chat keeps Velvet Signal in the loop across turns", async () => {
  const output = writer();
  const errorOutput = writer();
  const responses = [
    "What is Velvet Signal?",
    "Can I eat five-day chicken?",
    "/status",
    "/exit",
  ];
  const seen = [];
  let closed = false;
  let statusCalls = 0;

  await runLocalChat({
    modelName: "dolphin-mistral",
    output,
    errorOutput,
    createInterface: () => ({
      async question() {
        return responses.shift();
      },
      close() {
        closed = true;
      },
    }),
    getStatus: async () => {
      statusCalls += 1;
      return { activePatchCount: 7 };
    },
    turn: async (message, history) => {
      seen.push({ message, history });
      return {
        answer: `answer:${message}`,
        diagnostic: `[retrieval:${message}]`,
      };
    },
  });

  assert.equal(closed, true);
  assert.equal(statusCalls, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].history.length, 0);
  assert.deepEqual(seen[1].history, [
    { role: "user", content: "What is Velvet Signal?" },
    { role: "assistant", content: "answer:What is Velvet Signal?" },
  ]);
  assert.match(output.text(), /Velvet Signal Local Chat/);
  assert.match(output.text(), /Model: dolphin-mistral/);
  assert.match(output.text(), /Every turn passes through Velvet Signal retrieval before Ollama/);
  assert.match(output.text(), /Active patches: 7/);
  assert.match(output.text(), /dolphin-mistral > answer:What is Velvet Signal\?/);
  assert.match(errorOutput.text(), /\[retrieval:Can I eat five-day chicken\?\]/);
});

test("clear removes conversational history without touching the chat session", async () => {
  const output = writer();
  const responses = ["hello", "/clear", "again", "/exit"];
  const historyLengths = [];

  await runLocalChat({
    modelName: "test-model",
    output,
    errorOutput: writer(),
    createInterface: () => ({
      async question() {
        return responses.shift();
      },
      close() {},
    }),
    turn: async (message, history) => {
      historyLengths.push(history.length);
      return { answer: message };
    },
  });

  assert.deepEqual(historyLengths, [0, 0]);
  assert.match(output.text(), /Conversation history cleared\. Released patches are unchanged\./);
});
