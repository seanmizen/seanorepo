import type { FC } from 'react';
import { Entity, EntityList, ExternalLink } from '@/components';

/*
  Most of these are just text, so they render with the static chevron: dimmed,
  and it stays put when you hover. The Llama one holds a link, so it gets the
  interactive chevron instead — no extra markup needed to say so.
*/
const Todo: FC = () => {
  return (
    <EntityList>
      <Entity>implement some server-side code ✅</Entity>
      <Entity>add a database 🟨</Entity>
      <Entity>make some web requests ✅</Entity>
      <Entity>github contribution chart 🟨</Entity>
      <Entity>AI slop app</Entity>
      <Entity>
        <ExternalLink href="https://huggingface.co/meta-llama">
          Llama
        </ExternalLink>
        -on-phone for your auntie
      </Entity>
      <Entity>make the ui better (?)</Entity>
    </EntityList>
  );
};

export { Todo };
