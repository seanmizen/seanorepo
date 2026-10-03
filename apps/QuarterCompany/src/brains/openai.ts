// Any server with an OpenAI-compatible chat completions API: Ollama,
// llama.cpp, vLLM, LM Studio, OpenRouter. Local models run here.
import { jsonSchemaOf } from '../tools/index.ts';
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

interface ChatResponse {
  model?: string;
  choices: {
    message: { content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export const openaiBrain: Brain = async (ctx) => {
  const { session, casting } = ctx;
  const { actor } = casting;
  const provider = ctx.models.providers[actor.provider];
  const base = (provider.base_url ?? 'http://localhost:11434/v1').replace(
    /\/$/,
    '',
  );
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
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(request),
    });
    if (!res.ok)
      throw new Error(
        `${base} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const response = (await res.json()) as ChatResponse;
    const inTok = response.usage?.prompt_tokens ?? 0;
    const outTok = response.usage?.completion_tokens ?? 0;
    ctx.record({
      model: response.model ?? actor.model ?? '',
      request,
      response,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: (inTok * actor.price.in + outTok * actor.price.out) / 1e6,
    });
    const msg = response.choices[0]?.message;
    if (!msg) throw new Error(`${base} returned no choices.`);
    messages.push({
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.tool_calls,
    });
    if (!msg.tool_calls?.length) {
      session.endTurn((msg.content ?? '').trim(), 'next_turn');
      return;
    }
    for (const call of msg.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'The arguments are not valid JSON.',
        });
        continue;
      }
      const r = await session.call(call.function.name, args);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: r.ok ? r.text : `ERROR: ${r.text}`,
      });
    }
  }
};
