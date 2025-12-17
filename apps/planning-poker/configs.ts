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
    appDomain: 'https://planning-poker.com',
    backendPort: 4102, // <- must match nginx upstream
    apiPath: 'https://planning-poker.com/api',
    dbName: 'production.sqlite',
  },
};

export type { ConfigType };
