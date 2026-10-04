# 2026-10-04 — Benchmark of three local models

The note `2026-10-04-local-model-inefficiency.md` found that the model read
its prompt at 24 tokens a second. This benchmark measured three 4B models on
the same PC (GTX 980 Ti, Ollama 0.35.1), so that we can choose a faster one.

## Method

- Read speed: one prompt of about 1,950 tokens (the JSON of 20 tools), sent
  to `/api/generate` with `think: false` and `num_ctx` 8192. Each run starts
  with a different token, so no run uses the cache. The numbers come from
  `prompt_eval_count` and `prompt_eval_duration`.
- Tool calls: 4 tasks (`send_mail`, `list_mail`, `write_file`, `end_turn`),
  2 times each. Each request has the 14 tools of a worker and goes to
  `/v1/chat/completions` with `reasoning_effort: none`, as QuarterCompany
  sends it.

## Results

| Model | Prompt read | Write | `size_vram` | Correct tool calls | Time for each call |
|---|---|---|---|---|---|
| `huihui_ai/qwen3.5-abliterated:4B` | 23 tok/s | 33 to 52 tok/s | 8.0 GB | not tested | about 85 s |
| `qwen3:4b` | 371 tok/s | 29 to 36 tok/s | 4.0 GB | 5 of 8 | 19.4 s |
| `huihui_ai/qwen3-abliterated:4b` | 378 tok/s | 31 to 40 tok/s | 4.0 GB | 8 of 8 | 2.3 s |

- Ollama gives Qwen 3.5 8.0 GB on a 6 GB card, with an 8,192-token or a
  4,096-token context. `nvidia-smi` shows 5.9 GB used, so about 2 GB is
  probably in shared system memory. That, or the hybrid layers on Maxwell, can
  cause the slow reading. We did not test which one.
- A request that adds text to the last prompt uses the cache on all models.
  The same 1,943 tokens read again in 0.09 s.
- Qwen 3.5 cannot use the cache for a prompt that shares only its start with
  the last prompt. The Ollama log says "forcing full prompt re-processing due
  to lack of cache data (likely due to SWA or hybrid/recurrent memory)".
  Qwen3 can: a prompt with the same start read in 0.24 s.
- `qwen3:4b` does not obey `reasoning_effort: none`. It writes its reasoning
  in the reply text. In its 3 failures, it used all 600 tokens before a tool
  call. The abliterated build obeys the setting.

## Choice

The `local` tier now uses `huihui_ai/qwen3-abliterated:4b`. It reads 16
times faster than Qwen 3.5 and made all 8 tool calls correctly.
