// Any server with an OpenAI-compatible chat completions API: Ollama,
// llama.cpp, vLLM, LM Studio, OpenRouter. Local models run here.
//
// Small local models sometimes write a bad tool call. The brain reads native
// tool calls first. When a reply has none, it reads tool calls from the text
// in the Hermes form `<tool_call>{"name": ..., "arguments": ...}</tool_call>`.
// A call that the brain cannot read goes in the journal as a failed tool
// call, and the turn continues (REQ-QC-031).
import { jsonSchemaOf } from '../tools/index.ts';
import { baseOf, postJson } from './net.ts';
import type { Brain } from './types.ts';

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface RawCall {
  id?: string;
  function?: { name?: unknown; arguments?: unknown };
}

interface ChatResponse {
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: RawCall[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One tool call as the brain read it. `error` is set when it is not usable. */
export interface ReadCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  raw: unknown;
  error?: string;
}

/** Remove `<think>` blocks. Some local models put their reasoning in the text. */
export const stripThinking = (text: string) =>
  text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Read tool arguments: an object, or a JSON string of an object. */
export function readArgs(raw: unknown): {
  args?: Record<string, unknown>;
  error?: string;
} {
  if (raw === undefined || raw === null) return { args: {} };
  if (isObject(raw)) return { args: raw };
  if (typeof raw !== 'string')
    return { error: 'The arguments are not a JSON object.' };
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  if (!text) return { args: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
    // Some servers encode the arguments two times.
    if (typeof value === 'string') value = JSON.parse(value);
  } catch {
    return { error: 'The arguments are not valid JSON.' };
  }
  return isObject(value)
    ? { args: value }
    : { error: 'The arguments are not a JSON object.' };
}

function readCall(id: string, name: unknown, rawArgs: unknown): ReadCall {
  const toolName = typeof name === 'string' ? name.trim() : '';
  const { args, error } = readArgs(rawArgs);
  return {
    id,
    name: toolName || '(no name)',
    args: args ?? {},
    raw: rawArgs ?? {},
    error: toolName ? error : 'The tool call has no tool name.',
  };
}

/** Read native tool calls from a reply. */
export function nativeCalls(raw: RawCall[], step: number): ReadCall[] {
  return raw.map((c, i) =>
    readCall(
      typeof c.id === 'string' && c.id ? c.id : `call_${step}_${i}`,
      c.function?.name,
      c.function?.arguments,
    ),
  );
}

/**
 * Read tool calls from reply text: `<tool_call>` blocks, or one JSON object
 * with "name" and "arguments". Returns [] when the text has no tool call.
 */
export function textCalls(text: string, step: number): ReadCall[] {
  const blocks = [
    ...text.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g),
  ].map((m) => m[1].trim());
  const candidates = blocks.length
    ? blocks
    : /^\s*\{[\s\S]*"name"[\s\S]*\}\s*$/.test(text)
      ? [text.trim()]
      : [];
  return candidates.map((block, i) => {
    const id = `text_${step}_${i}`;
    let value: unknown;
    try {
      value = JSON.parse(block);
    } catch {
      return {
        id,
        name: '(unreadable)',
        args: {},
        raw: block,
        error: 'The tool call in the text is not valid JSON.',
      };
    }
    if (!isObject(value))
      return {
        id,
        name: '(unreadable)',
        args: {},
        raw: block,
        error: 'The tool call in the text is not a JSON object.',
      };
    return readCall(id, value.name, value.arguments ?? value.parameters);
  });
}

export const openaiBrain: Brain = async (ctx) => {
  const { session, casting } = ctx;
  const { actor } = casting;
  const provider = ctx.models.providers[actor.provider];
  const base = baseOf(provider);
  const key = provider.key_env ? process.env[provider.key_env] : undefined;
  const tools = session.tools().map((t) => {
    const j = jsonSchemaOf(t);
    return {
      type: 'function',
      function: {
        name: j.name,
        description: j.description,
        parameters: j.input_schema,
      },
    };
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: ctx.system },
    { role: 'user', content: ctx.briefing },
  ];

  for (let step = 0; step < actor.max_steps && !session.done; step++) {
    const request = {
      model: actor.model,
      max_tokens: actor.max_tokens,
      messages,
      tools,
      ...actor.extra_body,
    };
    const reply = await postJson(
      actor.provider,
      provider,
      `${base}/chat/completions`,
      request,
      key ? { authorization: `Bearer ${key}` } : {},
    );
    const response = reply.body as ChatResponse;
    const inTok = response.usage?.prompt_tokens ?? 0;
    const outTok = response.usage?.completion_tokens ?? 0;
    ctx.record({
      model: response.model ?? actor.model ?? '',
      request,
      response,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: (inTok * actor.price.in + outTok * actor.price.out) / 1e6,
      ms: reply.ms,
    });
    const msg = response.choices?.[0]?.message;
    if (!msg) throw new Error(`${base} returned no choices.`);
    const text = stripThinking(msg.content ?? '');
    const calls = msg.tool_calls?.length
      ? nativeCalls(msg.tool_calls, step)
      : textCalls(text, step);
    if (!calls.length) {
      session.endTurn(text, 'next_turn');
      return;
    }
    // Send the calls back in the native form, also when they came from text.
    messages.push({
      role: 'assistant',
      content: msg.tool_calls?.length ? (msg.content ?? null) : null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.name,
          arguments: typeof c.raw === 'string' ? c.raw : JSON.stringify(c.raw),
        },
      })),
    });
    for (const c of calls) {
      const r = c.error
        ? session.reject(c.name, c.raw, c.error)
        : await session.call(c.name, c.args);
      messages.push({
        role: 'tool',
        tool_call_id: c.id,
        content: r.ok ? r.text : `ERROR: ${r.text}`,
      });
    }
  }
};
