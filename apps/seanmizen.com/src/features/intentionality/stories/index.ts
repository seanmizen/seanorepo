import type { Story } from '../types';
import { shader } from './shader/story';

/* Every story, newest first. A new story is a folder here: its story.ts,
   and one folder for each stage with code, holding a main.tsx. The build
   makes each of those a page of its own (see rsbuild.config.js). */
const stories: Story[] = [shader];

export { stories };
