/* Stage s15-commit-and-tail of the shader story, as a page of its own. This is the
   only file in the folder written for the story. The rest are copies of the
   site's code at this stage, with only their import paths changed, and
   the tuning panel set to show outside the dev server. */
import { Route } from 'react-router-dom';
import { mountSample } from '@/features/intentionality/mount-sample';
import { Layout } from './layout';
import { Home } from './routes/home/home';
import { Projects } from './routes/projects/projects';

mountSample(
  <Route element={<Layout />}>
    <Route path="/projects" element={<Projects />} />
    <Route path="/*" element={<Home />} />
  </Route>,
);
