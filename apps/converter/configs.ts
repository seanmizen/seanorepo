// Shared port and URL config for the converter app.
// Mirrors the monorepo's dual-deployment pattern (4xxx = home server, 5xxx = Fly.io).

const isDev = process.env.NODE_ENV !== 'production';

export const devConfig = {
  feDomain: 'http://localhost:4050',
  fePort: 4050,
  bePort: 4051,
  apiBase: 'http://localhost:4051/api',
};

export const prodConfig = {
  feDomain: 'https://seansconverter.com',
  fePort: 4050,
  bePort: 4051,
  apiBase: '/api', // proxied by nginx in prod
};

export const flyConfig = {
  feDomain: 'https://converter.fly.dev',
  fePort: 5050,
  bePort: 5051,
  apiBase: '/api',
};

export const config = isDev ? devConfig : prodConfig;
