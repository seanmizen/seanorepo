const devConfig = {
  appDomain: "http://localhost:3000",
  // keep this flat for now
  serverApiPath: "http://localhost:4242/api",
  serverPort: 4242,
  productCode: "price_1QVfu2BsGhYF8YEWBId3mVNi",
  dbName: "dev.sqlite",
};

type ConfigType = typeof devConfig;

export const configs: Record<string, ConfigType> = {
  development: devConfig,
  production: {
    appDomain: "https://seanscards.com",
    serverApiPath: "https://seanscards.com/api",
    serverPort: 4242,
    productCode: "price_1QVfu2BsGhYF8YEWBId3mVNi",
    dbName: "staging.sqlite",
  },
  // add extra deployment configs here - let's say we whitelabel, lol
  // myBrandName: {...},
};

export type { ConfigType };
