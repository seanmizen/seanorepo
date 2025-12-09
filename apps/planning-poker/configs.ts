const devConfig = {
  appDomain: 'http://localhost:4010',
  serverApiPath: 'http://localhost:4011/api',
  serverPort: 4011,
  dbName: 'dev.sqlite',
};

type ConfigType = typeof devConfig;

export const configs: Record<string, ConfigType> = {
  development: devConfig,
  production: {
    appDomain: 'https://planning-poker.com',
    serverApiPath: 'https://planning-poker.com/api',
    serverPort: 4011,
    dbName: 'production.sqlite',
  },
};

export type { ConfigType };
