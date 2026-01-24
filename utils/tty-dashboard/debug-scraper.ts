import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(
    'https://www.nationalrail.co.uk/live-trains/departures/clapham-junction',
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const debug = await page.evaluate(() => {
    const nextDataScript = document.getElementById('__NEXT_DATA__');

    if (!nextDataScript) {
      return {
        found: false,
        scriptCount: document.querySelectorAll('script').length,
      };
    }

    const content = nextDataScript.textContent || '';
    try {
      const data = JSON.parse(content);
      const liveTrainsState = data?.props?.pageProps?.liveTrainsState;

      if (!liveTrainsState) {
        return {
          found: true,
          parsed: true,
          liveTrainsStateFound: false,
          keys: Object.keys(data?.props?.pageProps || {}),
        };
      }

      // Check the React Query structure
      const firstQuery = liveTrainsState.queries?.[0];
      const queryData = firstQuery?.state?.data;

      return {
        found: true,
        parsed: true,
        queryData: queryData
          ? {
              keys: Object.keys(queryData),
              pagesLength: queryData.pages?.length || 0,
              firstPageKeys: queryData.pages?.[0]
                ? Object.keys(queryData.pages[0])
                : [],
              servicesLength: queryData.pages?.[0]?.services?.length || 0,
              firstService: queryData.pages?.[0]?.services?.[0] || null,
            }
          : null,
      };
    } catch (e) {
      return { found: true, parsed: false, error: String(e) };
    }
  });

  console.log('Debug info:', JSON.stringify(debug, null, 2));
  await browser.close();
})();
