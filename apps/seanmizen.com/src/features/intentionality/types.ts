/* One message in a story: Sean's, exactly as he wrote it, or a short note
   from Claude on what it did. */
type Message = { from: 'sean' | 'claude'; text: string };

/* One stage of a story: the messages that led to it, and the folder of its
   frozen sample, when the stage changed code. `final` marks the stage Sean
   called the end of the piece. */
type Stage = {
  title: string;
  messages: Message[];
  sample?: string;
  final?: boolean;
};

/* How a piece of the site was built with AI, stage by stage. `id` is the
   story's folder under stories/, and `slug` is its page. */
type Story = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  stages: Stage[];
};

export type { Message, Stage, Story };
