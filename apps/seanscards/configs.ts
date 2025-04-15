const devConfig = {
  appDomain: "http://localhost:4010",
  // keep this flat for now
  serverApiPath: "http://localhost:4011/api",
  serverPort: 4011,
  productCode: "price_1QVfu2BsGhYF8YEWBId3mVNi",
  stripePublicKey:
    "pk_test_51QVX2JBsGhYF8YEWrWYtL7QL0oA5XoOD1YFZEFxlSVAaX6ob6iUWHju4Nrkj4fzrtjcdF7ntlhPZGIMq944HLGb9006Raprd5x",
  // keep secret keys out of the configs. this reaches the frontend.
  dbName: "dev.sqlite",
};

type ConfigType = typeof devConfig;

export const configs: Record<string, ConfigType> = {
  development: devConfig,
  production: {
    appDomain: "https://seanscards.com",
    serverApiPath: "https://seanscards.com/api",
    serverPort: 4011,
    // productCode: "prod_RPAFiu8SybeUa0",
    productCode: "price_1QWLvOBsGhYF8YEWNiZh0UDk",
    stripePublicKey:
      "pk_live_51QVX2JBsGhYF8YEWCf41ew9p8dQnMSABC0JW1X07wvIKpb2UvvQBmvlFgk0H8veUSUIk6JeEOt4tvcKC20D3icx200lZjNDV6e",
    dbName: "staging.sqlite",
  },
  // add extra deployment configs here - let's say we whitelabel, lol
  // myBrandName: {...},
};

export type { ConfigType };
