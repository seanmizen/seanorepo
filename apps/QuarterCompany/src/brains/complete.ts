// One text completion with no tools, through the same provider layer as the
// brains: providers.yaml, actors.yaml and the cast. A population uses it to
// write its variant pool once (REQ-QC-024). An `openai-compatible` provider
// such as Ollama works offline.
import Anthropic from '@anthropic-ai/sdk';
import type { Actor, Models } from '../cast.ts';
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
  if (provider.kind === 'anthropic') {
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
      },
    };
  }
  const base = (provider.base_url ?? 'http://localhost:11434/v1').replace(
    /\/$/,
    '',
  );
  const request = {
    model: actor.model,
    max_tokens: actor.max_tokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
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
  const response = (await res.json()) as {
    model?: string;
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const inTok = response.usage?.prompt_tokens ?? 0;
  const outTok = response.usage?.completion_tokens ?? 0;
  return {
    text: response.choices[0]?.message.content ?? '',
    call: {
      model: response.model ?? actor.model ?? '',
      request,
      response,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: (inTok * actor.price.in + outTok * actor.price.out) / 1e6,
    },
  };
}
