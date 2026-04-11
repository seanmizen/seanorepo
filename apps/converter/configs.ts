// Shared port and URL config for the converter app.
// Mirrors the monorepo's dual-deployment pattern (4xxx = home server, 5xxx = Fly.io).

const isDev = process.env.NODE_ENV !== 'production';

export const devConfig = {
  feDomain: 'http://localhost:4040',
  fePort: 4040,
  bePort: 4041,
  apiBase: 'http://localhost:4041/api',
};

export const prodConfig = {
  feDomain: 'https://converter.yourdomain.com',
  fePort: 4040,
  bePort: 4041,
  apiBase: '/api', // proxied by nginx in prod
};

export const flyConfig = {
  feDomain: 'https://converter.fly.dev',
  fePort: 5040,
  bePort: 5041,
  apiBase: '/api',
};

export const config = isDev ? devConfig : prodConfig;
