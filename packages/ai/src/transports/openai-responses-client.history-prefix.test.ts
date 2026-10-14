import assert from "node:assert/strict";
import type { Context, Model } from "@openclaw/llm-core";
import { stableStringify } from "@openclaw/normalization-core";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { expect, it } from "vitest";
import {
  assertStableProviderPrefix,
  snapshotProviderPrefix,
} from "../../../../scripts/e2e/lib/anthropic-cache/prefix-stability.mts";
import { sanitizeTranscriptMessage } from "../../../../src/agents/transcript-sanitize.js";
import { configureAiTransportHost, getAiTransportHost } from "../host.js";
import { cleanupSessionResources } from "../session-resources.js";
import { createOpenAIResponsesTransportStreamFn } from "./openai-responses-client.js";

it("preserves provider reasoning containers from warm continuation through cold transcript replay", async () => {
  const model: Model<"openai-responses"> = {
    id: "gpt-5.4",
    name: "Synthetic prefix replay",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    compat: { supportsResponsesContinuation: true },
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 1024,
  };
  const sessionId = "reasoning-container-prefix";
  const context: Context = {
    systemPrompt: "Stable instructions.",
    messages: [{ role: "user", content: "Synthetic runtime context.", timestamp: 0 }],
    tools: [
      { name: "cache_probe", description: "Synthetic probe", parameters: { type: "object" } },
    ],
  };
  const host = getAiTransportHost();
  const requests: Record<string, unknown>[] = [];
  const prefixes: ReturnType<typeof snapshotProviderPrefix>[] = [];
  const history = new Map<string, unknown[]>();
  configureAiTransportHost({
    ...host,
    buildModelFetch: () => async (input, init) => {
      const payload: unknown = await new Request(input, init).json();
      assert(isRecord(payload) && Array.isArray(payload.input));
      const inherited =
        typeof payload.previous_response_id === "string"
          ? history.get(payload.previous_response_id)
          : [];
      assert(inherited);
      const effectiveInput = [...inherited, ...payload.input];
      requests.push(payload);
      // Match the release gate: ignore provider message/call envelopes, not reasoning fields.
      const comparable = effectiveInput.map((item) => {
        if (
          !isRecord(item) ||
          (item.type !== "function_call" && !(item.type === "message" && item.role === "assistant"))
        ) {
          return item;
        }
        const { id: _id, status: _status, ...rest } = item;
        return rest;
      });
      prefixes.push(
        snapshotProviderPrefix(
          "openai-responses",
          JSON.parse(stableStringify({ ...payload, input: comparable })),
        ),
      );
      const id = `response_${requests.length}`;
      const output = [
        {
          type: "reasoning",
          id: `rs_${id}`,
          summary: [],
          content: [],
          encrypted_content: `encrypted_${id}`,
        },
        requests.length % 3 !== 0
          ? {
              type: "function_call",
              id: `fc_${id}`,
              call_id: `call_${id}`,
              name: "cache_probe",
              arguments: "{}",
            }
          : {
              type: "message",
              id: `msg_${id}`,
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Synthetic answer.", annotations: [] }],
            },
      ];
      history.set(id, [...effectiveInput, ...output]);
      const events = [
        ...output.flatMap((item, output_index) => [
          { type: "response.output_item.added", output_index, item },
          { type: "response.output_item.done", output_index, item },
        ]),
        {
          type: "response.completed",
          response: {
            id,
            status: "completed",
            output,
            usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          },
        },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    const stream = createOpenAIResponsesTransportStreamFn();
    for (let turn = 1; turn <= 4; turn++) {
      if (turn === 3) {
        context.messages.push({ role: "user", content: "Updated instructions.", timestamp: 3 });
      }
      if (turn === 4) {
        cleanupSessionResources(sessionId);
        const persistedTranscript = JSON.stringify(
          context.messages.map((message) => sanitizeTranscriptMessage(message)),
        );
        context.messages = JSON.parse(persistedTranscript);
      }
      context.messages.push({
        role: "user",
        content: `Before hook.\nVisible turn ${turn}.\nAfter hook.`,
        timestamp: turn,
      });
      for (let step = 0; step < 3; step++) {
        const response = await stream(model, context, {
          apiKey: "synthetic-prefix-key",
          sessionId,
          transport: "sse",
        });
        const assistant = await response.result();
        expect(assistant.errorMessage).toBeUndefined();
        context.messages.push(assistant);
        const call = assistant.content.find((block) => block.type === "toolCall");
        expect(assistant.stopReason).toBe(step < 2 ? "toolUse" : "stop");
        if (call) {
          context.messages.push({
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: [{ type: "text", text: "Synthetic record." }],
            isError: false,
            timestamp: turn,
          });
        }
      }
    }
    expect(requests).toHaveLength(12);
    expect(requests[8]?.previous_response_id).toBe("response_8");
    expect(requests[9]?.previous_response_id).toBeUndefined();
    for (let index = 1; index < prefixes.length; index++) {
      const previous = prefixes[index - 1];
      const next = prefixes[index];
      assert(previous && next);
      assertStableProviderPrefix(previous, next, {
        label: `request ${index + 1}`,
      });
    }
    const reopenedReasoning = prefixes[9]?.history[2];
    assert(reopenedReasoning);
    expect(JSON.parse(reopenedReasoning)).toEqual({
      type: "reasoning",
      id: "rs_response_1",
      summary: [],
      content: [],
      encrypted_content: "encrypted_response_1",
    });
  } finally {
    configureAiTransportHost(host);
    cleanupSessionResources(sessionId);
  }
});
