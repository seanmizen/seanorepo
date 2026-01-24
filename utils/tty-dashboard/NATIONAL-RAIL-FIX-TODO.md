# National Rail Scraper Fix

## Problem
CSS selectors broke after National Rail site update. Using fragile generated class names like `sc-f6950b8f-0`.

## Solution
Extract embedded JSON from script tag instead of DOM scraping.

## Changes Needed

1. **Update `extractTrainDepartures()` function**
   - Find script tag containing `liveTrainsState`
   - Parse JSON to get services array
   - Map JSON fields to TrainDeparture interface

2. **Field Mapping**
   - ✅ scheduledTime: `departureInfo.scheduled` (parse time)
   - ✅ expectedTime: `departureInfo.estimated` (parse time)
   - ✅ status: `status.status` ("OnTime" → "On time")
   - ✅ destination: `destination[0].locationName`
   - ✅ destinationCode: `destination[0].crs`
   - ✅ platform: `platform`
   - ✅ stops: `journeyDetails.stops` (format as "X stops")
   - ✅ operator: `operator.name`
   - ⚠️ callingAt: Not available (set to empty string)
   - ⚠️ duration: Calculate from departure/arrival times
   - ⚠️ delayReason: Use `status.delay` if available
   - ✅ isDelayed: `status.status !== "OnTime"`

3. **Test**
   - Run against live data
   - Verify all fields populate correctly
   - Handle missing/null fields gracefully
