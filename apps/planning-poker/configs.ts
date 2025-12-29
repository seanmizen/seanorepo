const devConfig = {
  appDomain: 'http://localhost:4040',
  backendPort: 4041, // Fastify/Bun dev port
  apiPath: 'http://localhost:4041/api',
  dbName: 'dev.sqlite',
};

type ConfigType = typeof devConfig;

export const configs: Record<'development' | 'production', ConfigType> = {
  development: devConfig,
  production: {
    appDomain: 'https://pp.seanmizen.com',
    backendPort: 4041, // <- must match docker-compose
    apiPath: 'https://pp.seanmizen.com/api',
    dbName: 'production.sqlite',
  },
};

export type { ConfigType };
