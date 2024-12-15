const devConfig = {
  appBasename: "http://localhost:3000",
  // keep this flat for now
  serverUri: "http://localhost",
  serverPort: 4242,
  serverApiPath: "http://localhost:4242/api",
  productCode: "price_1QVfu2BsGhYF8YEWBId3mVNi",
};

type ConfigType = typeof devConfig;

export const configs: Record<string, ConfigType> = {
  development: devConfig,
  production: {
    appBasename: "https://seanscards.com",
    serverUri: "https://seanscards.com",
    serverPort: 4242,
    serverApiPath: "https://seanscards.com/api",
    productCode: "price_1QVfu2BsGhYF8YEWBId3mVNi",
  },
  // add extra deployment configs here - let's say we whitelabel, lol
  // myBrandName: {...},
};

export type { ConfigType };
