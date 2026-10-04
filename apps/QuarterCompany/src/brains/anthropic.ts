// Claude through the Anthropic SDK, with a manual tool loop. The engine owns
// the loop because the turn's time budget decides when it stops.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOf } from '../tools/index.ts';
import { anthropicBase, checkOffline } from './net.ts';
import type { Brain } from './types.ts';

const textOf = (content: Anthropic.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

export const anthropicBrain: Brain = async (ctx) => {
  const { session, casting } = ctx;
  const { actor } = casting;
  const provider = ctx.models.providers[actor.provider];
  checkOffline(actor.provider, anthropicBase(provider.base_url));
  const apiKey = provider.key_env ? process.env[provider.key_env] : undefined;
  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(provider.base_url ? { baseURL: provider.base_url } : {}),
  });
  const tools = session.tools().map(jsonSchemaOf) as Anthropic.Tool[];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: ctx.briefing },
  ];

  for (let step = 0; step < actor.max_steps && !session.done; step++) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: actor.model as string,
      max_tokens: actor.max_tokens,
      system: [
        {
          type: 'text',
          text: ctx.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages,
      ...(actor.effort ? { output_config: { effort: actor.effort } } : {}),
    };
    const t0 = performance.now();
    const response = await client.messages.create(params);
    const u = response.usage;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    ctx.record({
      model: response.model,
      request: params,
      response,
      inputTokens: u.input_tokens + cacheWrite + cacheRead,
      outputTokens: u.output_tokens,
      costUsd:
        ((u.input_tokens + cacheWrite * 1.25 + cacheRead * 0.1) *
          actor.price.in +
          u.output_tokens * actor.price.out) /
        1e6,
      ms: Math.round(performance.now() - t0),
    });
    messages.push({ role: 'assistant', content: response.content });

    if (
      response.stop_reason === 'refusal' ||
      response.stop_reason === 'max_tokens'
    ) {
      session.endTurn(
        `(the model stopped: ${response.stop_reason})`,
        'next_turn',
      );
      return;
    }
    const uses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!uses.length) {
      session.endTurn(textOf(response.content), 'next_turn');
      return;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const r = await session.call(use.name, use.input);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: r.text,
        is_error: !r.ok,
      });
    }
    messages.push({ role: 'user', content: results });
  }
};
