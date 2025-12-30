const devConfig = {
  appDomain: 'http://localhost:4030',
  backendPort: 4031, // Fastify/Bun dev port
  apiPath: 'http://localhost:4031/api',
  dbName: 'dev.sqlite',
};

type ConfigType = typeof devConfig;

export const configs: Record<'development' | 'production', ConfigType> = {
  development: devConfig,
  production: {
    appDomain: 'https://pp.seanmizen.com',
    backendPort: 4031, // <- must match docker-compose
    apiPath: 'https://pp.seanmizen.com/api',
    dbName: 'production.sqlite',
  },
};

export type { ConfigType };
