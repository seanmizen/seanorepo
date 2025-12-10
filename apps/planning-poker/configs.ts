const devConfig = {
  appDomain: 'http://localhost:4040',
  serverApiPath: 'http://localhost:4041/api',
  serverPort: 4041,
  dbName: 'dev.sqlite',
};

type ConfigType = typeof devConfig;

export const configs: Record<string, ConfigType> = {
  development: devConfig,
  production: {
    appDomain: 'https://planning-poker.com',
    serverApiPath: 'https://planning-poker.com/api',
    serverPort: 4041,
    dbName: 'production.sqlite',
  },
};

export type { ConfigType };
