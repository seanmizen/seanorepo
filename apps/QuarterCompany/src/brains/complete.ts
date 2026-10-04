// One text completion with no tools, through the same provider layer as the
// brains: providers.yaml, actors.yaml and the cast. A population uses it to
// write its variant pool once (REQ-QC-024). An `openai-compatible` provider
// such as Ollama works offline.
import Anthropic from '@anthropic-ai/sdk';
import type { Actor, Models } from '../cast.ts';
import { anthropicBase, baseOf, checkOffline, postJson } from './net.ts';
import { stripThinking } from './openai.ts';
import type { ModelCallRecord } from './types.ts';

export async function complete(
  models: Models,
  actor: Actor,
  system: string,
  prompt: string,
): Promise<{ text: string; call: ModelCallRecord }> {
  const provider = models.providers[actor.provider];
  if (!provider)
    throw new Error(
      `Actor provider "${actor.provider}" is not in providers.yaml.`,
    );
  const key = provider.key_env ? process.env[provider.key_env] : undefined;
  const t0 = performance.now();
  if (provider.kind === 'anthropic') {
    checkOffline(actor.provider, anthropicBase(provider.base_url));
    const client = new Anthropic({
      ...(key ? { apiKey: key } : {}),
      ...(provider.base_url ? { baseURL: provider.base_url } : {}),
    });
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: actor.model as string,
      max_tokens: actor.max_tokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    };
    const response = await client.messages.create(request);
    const u = response.usage;
    return {
      text: response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
      call: {
        model: response.model,
        request,
        response,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        costUsd:
          (u.input_tokens * actor.price.in +
            u.output_tokens * actor.price.out) /
          1e6,
        ms: Math.round(performance.now() - t0),
      },
    };
  }
  const base = baseOf(provider);
  const request = {
    model: actor.model,
    max_tokens: actor.max_tokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    ...actor.extra_body,
  };
  const response = (await postJson(
    actor.provider,
    provider,
    `${base}/chat/completions`,
    request,
    key ? { authorization: `Bearer ${key}` } : {},
  )) as {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const inTok = response.usage?.prompt_tokens ?? 0;
  const outTok = response.usage?.completion_tokens ?? 0;
  return {
    text: stripThinking(response.choices?.[0]?.message?.content ?? ''),
    call: {
      model: response.model ?? actor.model ?? '',
      request,
      response,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: (inTok * actor.price.in + outTok * actor.price.out) / 1e6,
      ms: Math.round(performance.now() - t0),
    },
  };
}
