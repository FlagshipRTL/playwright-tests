import { test, expect, Page } from '@playwright/test';

/**
 * Single Product Lost Sales Test
 * Tests Alpaca Cardigan / Cacao specifically to validate extraction logic
 */

const BRAND_KEY = 'industry-of-all-nations';

interface MonitoringData {
  months: string[];
  values: number[];
}

interface PlanningData {
  headers: string[];
  values: number[];
}

async function extractPlanningLostSales(page: Page): Promise<PlanningData> {
  await page.waitForSelector('text=Potential Lost Sales', { timeout: 15000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    // Find all StaticText elements that match month pattern "MMM YYYY"
    const allElements = Array.from(document.body.querySelectorAll('*'));
    const monthPattern = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i;

    const headers: string[] = [];
    const seenMonths = new Set<string>();

    for (const el of allElements) {
      const text = el.textContent?.trim().toUpperCase() || '';
      if (monthPattern.test(text) && el.children.length === 0) {
        const month = text.split(' ')[0];
        if (!seenMonths.has(text)) {
          seenMonths.add(text);
          headers.push(month);
        }
      }
    }

    // Find the TH containing "Potential Lost Sales" (not "Replenishment Lost Sales")
    const ths = Array.from(document.querySelectorAll('th'));
    const potentialLostSalesTh = ths.find(th =>
      th.textContent?.includes('Potential Lost Sales') &&
      !th.textContent?.includes('Replenishment')
    );

    if (!potentialLostSalesTh) {
      return { headers: [], values: [], debug: 'TH not found' };
    }

    // Get the parent TR and extract button values
    const row = potentialLostSalesTh.closest('tr');
    if (!row) {
      return { headers: [], values: [], debug: 'TR not found' };
    }

    const buttons = Array.from(row.querySelectorAll('button'));
    const values: number[] = [];

    for (const button of buttons) {
      const text = button.textContent?.trim() || '';
      const num = parseInt(text.replace(/,/g, ''));
      if (!isNaN(num)) {
        values.push(num);
      }
    }

    return { headers: headers.slice(0, 18), values };
  });

  console.log(`[Planning] Headers: [${result.headers.slice(0, 6).join(', ')}...] (${result.headers.length} total)`);
  console.log(`[Planning] Values: [${result.values.slice(0, 6).join(', ')}...] (${result.values.length} total)`);

  return result;
}

async function extractAllMonitoringColors(page: Page): Promise<Map<string, MonitoringData>> {
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const colorData: Array<{ color: string; months: string[]; values: number[] }> = [];

    // Find all links that point to planning pages with color parameter
    const planningLinks = Array.from(document.querySelectorAll('a[href*="supply/planning"][href*="color="]'));

    const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                        'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const shortMonths: Record<string, string> = {
      'JANUARY': 'JAN', 'FEBRUARY': 'FEB', 'MARCH': 'MAR', 'APRIL': 'APR',
      'MAY': 'MAY', 'JUNE': 'JUN', 'JULY': 'JUL', 'AUGUST': 'AUG',
      'SEPTEMBER': 'SEP', 'OCTOBER': 'OCT', 'NOVEMBER': 'NOV', 'DECEMBER': 'DEC'
    };

    for (const link of planningLinks) {
      const colorName = link.textContent?.trim() || '';
      if (!colorName) continue;

      const months: string[] = [];
      const values: number[] = [];

      // The structure is a TABLE - go up to TR level to find h4 month headings
      const row = link.closest('tr');
      if (!row) continue;

      // Find h4s in this row
      const h4s = Array.from(row.querySelectorAll('h4'));

      for (const h4 of h4s) {
        const text = h4.textContent?.trim().toUpperCase() || '';
        if (monthNames.includes(text)) {
          months.push(shortMonths[text] || text.slice(0, 3));
          // Get the next sibling for value
          const valueEl = h4.nextElementSibling;
          if (valueEl) {
            const valText = valueEl.textContent?.trim() || '';
            const num = parseInt(valText.replace(/,/g, ''));
            values.push(isNaN(num) ? 0 : num);
          }
        }
        if (months.length >= 3) break;
      }

      if (months.length === 3 && values.length === 3) {
        colorData.push({ color: colorName, months, values });
      }
    }

    return colorData;
  });

  const colorMap = new Map<string, MonitoringData>();
  for (const { color, months, values } of result) {
    colorMap.set(color, { months, values });
  }

  console.log(`[Monitoring] Extracted ${colorMap.size} colors`);
  return colorMap;
}

test.describe('Single Product Lost Sales Validation', () => {
  test('Alpaca Cardigan / Cacao', async ({ page }) => {
    const style = 'Alpaca Cardigan';
    const color = 'Cacao';

    // Step 1: Navigate to Monitoring page
    const monitoringUrl = `https://staging.flagshipai.com/brand/${BRAND_KEY}/supply/monitoring?channel=ecommerce&region=global&department=Apparel&category=Tops&class=Cardigan&style=Alpaca+Cardigan`;

    console.log(`\n=== Testing: ${style} / ${color} ===`);
    console.log(`Monitoring URL: ${monitoringUrl}`);

    await page.goto(monitoringUrl);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Step 2: Expand colors
    const expandButton = page.getByRole('button', { name: 'Expand colors' });
    const expandExists = await expandButton.count() > 0;

    if (expandExists) {
      console.log('Clicking "Expand colors" button...');
      await expandButton.click();
      await page.waitForTimeout(1500);
    }

    // Step 3: Extract all monitoring data
    const allColors = await extractAllMonitoringColors(page);
    console.log(`Found colors: ${Array.from(allColors.keys()).join(', ')}`);

    expect(allColors.has(color), `Color "${color}" should be found in monitoring`).toBe(true);

    const monitoringData = allColors.get(color)!;
    console.log(`[Monitoring] ${color}: ${monitoringData.months.join(', ')} = [${monitoringData.values.join(', ')}]`);

    expect(monitoringData.months.length, 'Should have 3 months').toBe(3);
    expect(monitoringData.values.length, 'Should have 3 values').toBe(3);

    // Step 4: Navigate to Planning page
    const planningUrl = `https://staging.flagshipai.com/brand/${BRAND_KEY}/supply/planning?channel=ecommerce&region=global&department=Apparel&category=Tops&class=Cardigan&style=Alpaca+Cardigan&color=Cacao`;

    console.log(`Planning URL: ${planningUrl}`);
    await page.goto(planningUrl);
    await page.waitForLoadState('load');

    // Step 5: Extract Planning data
    const planningData = await extractPlanningLostSales(page);

    expect(planningData.headers.length, 'Planning should have month headers').toBeGreaterThan(0);
    expect(planningData.values.length, 'Planning should have values').toBeGreaterThan(0);

    // Step 6: Compare values
    console.log(`\nComparing values:`);
    const mismatches: Array<{ month: string; monitoring: number; planning: number }> = [];

    for (let i = 0; i < monitoringData.months.length; i++) {
      const month = monitoringData.months[i];
      const monitoringValue = monitoringData.values[i];
      const planningIndex = planningData.headers.indexOf(month);

      if (planningIndex === -1) {
        console.log(`Warning: Month ${month} not found in planning headers`);
        continue;
      }

      const planningValue = planningData.values[planningIndex];
      const match = monitoringValue === planningValue;

      console.log(`  ${month}: Monitoring=${monitoringValue}, Planning=${planningValue} ${match ? '✓' : '✗'}`);

      if (!match) {
        mismatches.push({ month, monitoring: monitoringValue, planning: planningValue });
      }
    }

    expect(mismatches, 'Lost sales values should match').toHaveLength(0);
  });

  test('Alpaca Cardigan / Heather Grey', async ({ page }) => {
    const style = 'Alpaca Cardigan';
    const color = 'Heather Grey';

    const monitoringUrl = `https://staging.flagshipai.com/brand/${BRAND_KEY}/supply/monitoring?channel=ecommerce&region=global&department=Apparel&category=Tops&class=Cardigan&style=Alpaca+Cardigan`;

    console.log(`\n=== Testing: ${style} / ${color} ===`);

    await page.goto(monitoringUrl);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    const expandButton = page.getByRole('button', { name: 'Expand colors' });
    if (await expandButton.count() > 0) {
      await expandButton.click();
      await page.waitForTimeout(1500);
    }

    const allColors = await extractAllMonitoringColors(page);
    console.log(`Found colors: ${Array.from(allColors.keys()).join(', ')}`);

    expect(allColors.has(color), `Color "${color}" should be found in monitoring`).toBe(true);

    const monitoringData = allColors.get(color)!;
    console.log(`[Monitoring] ${color}: ${monitoringData.months.join(', ')} = [${monitoringData.values.join(', ')}]`);

    const planningUrl = `https://staging.flagshipai.com/brand/${BRAND_KEY}/supply/planning?channel=ecommerce&region=global&department=Apparel&category=Tops&class=Cardigan&style=Alpaca+Cardigan&color=Heather+Grey`;

    await page.goto(planningUrl);
    await page.waitForLoadState('load');

    const planningData = await extractPlanningLostSales(page);

    console.log(`\nComparing values:`);
    const mismatches: Array<{ month: string; monitoring: number; planning: number }> = [];

    for (let i = 0; i < monitoringData.months.length; i++) {
      const month = monitoringData.months[i];
      const monitoringValue = monitoringData.values[i];
      const planningIndex = planningData.headers.indexOf(month);

      if (planningIndex === -1) continue;

      const planningValue = planningData.values[planningIndex];
      const match = monitoringValue === planningValue;

      console.log(`  ${month}: Monitoring=${monitoringValue}, Planning=${planningValue} ${match ? '✓' : '✗'}`);

      if (!match) {
        mismatches.push({ month, monitoring: monitoringValue, planning: planningValue });
      }
    }

    expect(mismatches, 'Lost sales values should match').toHaveLength(0);
  });
});
