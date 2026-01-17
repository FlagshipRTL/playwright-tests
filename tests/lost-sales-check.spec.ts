import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Lost Sales - Planning vs. Monitoring
 * Validates "Potential Lost Sales" (Supply Planning) matches "Lost sales if you don't order" (Supply Monitoring)
 *
 * Test Strategy:
 * 1. Navigate to style's Supply Monitoring page -> expand colors
 * 2. Extract lost sales for target color (3 months displayed on monitoring page)
 * 3. Navigate to color's Planning page -> extract Potential Lost Sales time series
 * 4. Compare: Monitoring values must match corresponding months in Planning
 */

// Configuration
const BRAND_KEY = process.env.BRAND_KEY || 'uat-bocop';
const BASE_DOMAIN = process.env.PROD === 'true' ? 'flagshipai.com' : 'staging.flagshipai.com';

interface MonitoringData {
  months: string[];  // e.g., ['SEP', 'OCT', 'NOV']
  values: number[];  // e.g., [2, 5, 1]
}

interface PlanningData {
  headers: string[];  // e.g., ['JAN', 'FEB', 'MAR', ...]
  values: number[];   // e.g., [11, 1, 0, ...]
}

/**
 * Extract "Potential Lost Sales" row from Supply Planning page
 * The page structure shows:
 * - Header row with "JAN 2026", "FEB 2026", etc. as StaticText elements
 * - "Potential Lost Sales" label in a TH element, followed by button elements with values in the same TR
 */
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
        // Extract just the month part (e.g., "JAN" from "JAN 2026")
        const month = text.split(' ')[0];
        // Only add if we haven't seen this exact text (avoid duplicates from nested elements)
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

    // Extract values from buttons in order
    const buttons = Array.from(row.querySelectorAll('button'));
    const values: number[] = [];

    for (const button of buttons) {
      const text = button.textContent?.trim() || '';
      const num = parseInt(text.replace(/,/g, ''));
      if (!isNaN(num)) {
        values.push(num);
      }
    }

    // Take only the first 18 headers to match the number of values typically shown
    return { headers: headers.slice(0, 18), values };
  });

  console.log(`[Planning] Headers: [${result.headers.slice(0, 6).join(', ')}...] (${result.headers.length} total)`);
  console.log(`[Planning] Values: [${result.values.slice(0, 6).join(', ')}...] (${result.values.length} total)`);

  return result;
}

/**
 * Extract lost sales for a specific color from Supply Monitoring expanded view
 *
 * Page structure after expanding colors:
 * - Each color row has: link (color name) -> h4 (month) -> value -> h4 (month) -> value -> h4 (month) -> value
 * - The months shown are the same for all colors (e.g., September, October, November)
 */
async function extractMonitoringLostSales(page: Page, colorName: string): Promise<MonitoringData> {
  await page.waitForTimeout(500);

  const result = await page.evaluate((targetColor) => {
    // Find the link element with the exact color name
    const colorLinks = Array.from(document.querySelectorAll('a'));
    const colorLink = colorLinks.find(a => a.textContent?.trim() === targetColor);

    if (!colorLink) {
      console.log(`Color link not found: ${targetColor}`);
      return { months: [], values: [], debug: `Color link "${targetColor}" not found` };
    }

    // Get the parent row/container for this color
    let container = colorLink.parentElement;

    // The structure has the color link, then h4 headings for months with values after them
    // We need to find h4 elements that come after this color link in the DOM flow

    // Strategy: Find all h4 elements after this color link in document order
    const allH4s = Array.from(document.querySelectorAll('h4'));
    const colorLinkIndex = Array.from(document.querySelectorAll('*')).indexOf(colorLink);

    // Find h4s that are:
    // 1. After the color link in DOM order
    // 2. Have month names (September, October, November, etc.)
    // 3. Before the next color link

    const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                        'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const shortMonths: Record<string, string> = {
      'JANUARY': 'JAN', 'FEBRUARY': 'FEB', 'MARCH': 'MAR', 'APRIL': 'APR',
      'MAY': 'MAY', 'JUNE': 'JUN', 'JULY': 'JUL', 'AUGUST': 'AUG',
      'SEPTEMBER': 'SEP', 'OCTOBER': 'OCT', 'NOVEMBER': 'NOV', 'DECEMBER': 'DEC'
    };

    const months: string[] = [];
    const values: number[] = [];

    // Find the table row that contains the color link and its h4s
    // CRITICAL: Must use closest('tr') - using closest('[class*="grid"]') finds a container
    // that spans ALL rows, causing style-level values to be extracted instead of color-level
    const rowContainer = colorLink.closest('tr');

    if (!rowContainer) {
      // Fallback: traverse siblings
      let sibling = colorLink.nextElementSibling || colorLink.parentElement?.nextElementSibling;
      let count = 0;

      while (sibling && count < 20) {
        if (sibling.tagName === 'H4') {
          const text = sibling.textContent?.trim().toUpperCase() || '';
          if (monthNames.includes(text)) {
            months.push(shortMonths[text] || text.slice(0, 3));
            // Get next sibling for value
            const valueEl = sibling.nextElementSibling;
            if (valueEl) {
              const valText = valueEl.textContent?.trim() || '';
              const num = parseInt(valText.replace(/,/g, ''));
              values.push(isNaN(num) ? 0 : num);
            }
          }
        }
        sibling = sibling.nextElementSibling;
        count++;
        if (months.length >= 3) break;
      }
    } else {
      // Find h4s within the row container
      const h4s = rowContainer.querySelectorAll('h4');
      for (const h4 of h4s) {
        const text = h4.textContent?.trim().toUpperCase() || '';
        if (monthNames.includes(text)) {
          months.push(shortMonths[text] || text.slice(0, 3));
          // Get next sibling for value
          const valueEl = h4.nextElementSibling;
          if (valueEl) {
            const valText = valueEl.textContent?.trim() || '';
            const num = parseInt(valText.replace(/,/g, ''));
            values.push(isNaN(num) ? 0 : num);
          }
        }
        if (months.length >= 3) break;
      }
    }

    return { months, values };
  }, colorName);

  console.log(`[Monitoring] ${colorName}: ${result.months.join(', ')} = [${result.values.join(', ')}]`);

  return result;
}

/**
 * Alternative extraction: Get all color data at once from expanded monitoring page
 * More reliable as it parses the entire structure using TABLE/TR structure
 */
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

/**
 * Compare Monitoring lost sales (3 months) against Planning time series
 * Finds the corresponding months in planning headers and compares values
 */
function compareValues(
  monitoringData: MonitoringData,
  planningData: PlanningData,
  colorName: string
): { match: boolean; mismatches: Array<{ month: string; monitoring: number; planning: number }> } {
  const mismatches: Array<{ month: string; monitoring: number; planning: number }> = [];

  for (let i = 0; i < monitoringData.months.length; i++) {
    const month = monitoringData.months[i];
    const monitoringValue = monitoringData.values[i];

    // Find this month in planning headers
    const planningIndex = planningData.headers.indexOf(month);

    if (planningIndex === -1) {
      console.log(`Warning: Month ${month} not found in planning headers for ${colorName}`);
      console.log(`Planning headers: ${planningData.headers.join(', ')}`);
      continue;
    }

    const planningValue = planningData.values[planningIndex];

    if (monitoringValue !== planningValue) {
      mismatches.push({
        month,
        monitoring: monitoringValue,
        planning: planningValue
      });
    }
  }

  const status = mismatches.length === 0 ? 'MATCH' : `${mismatches.length} MISMATCHES`;
  console.log(`[Compare] ${colorName}: ${status}`);

  return { match: mismatches.length === 0, mismatches };
}

// Load style-color combinations from CSV
function loadStyleColors(): Array<{
  department: string;
  category: string;
  class: string;
  style: string;
  color: string;
  channel: string;
  region: string;
}> {
  // Map brand keys to their CSV files
  const csvFiles: { [key: string]: string } = {
    'uat-bocop': 'uat_account_style_color_list.csv',
    'industry-of-all-nations': 'ioan_all_with_lost_sales.csv',
    'public-rec': 'public_rec_with_lost_sales.csv',
    'twillory-test': 'twillory_with_lost_sales.csv'
  };

  const csvFile = csvFiles[BRAND_KEY] || csvFiles['uat-bocop'];

  const csvPath = path.resolve(__dirname, '..', 'data', csvFile);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0].replace(/"/g, '').split(',');

  const products = lines.slice(1).map(line => {
    // Handle quoted CSV fields
    const values = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"|"$/g, '')) || [];

    return {
      department: values[header.indexOf('DEPARTMENT')],
      category: values[header.indexOf('CATEGORY')],
      class: values[header.indexOf('CLASS')],
      style: values[header.indexOf('STYLE')],
      color: values[header.indexOf('COLOR')],
      channel: values[header.indexOf('CHANNEL')] || 'ecommerce',
      region: values[header.indexOf('REGION_NAME')] || 'global',
    };
  }).filter(p => p.style && p.color);

  console.log(`Loaded ${products.length} style-color combinations from ${csvFile}`);
  return products;
}

const STYLE_COLORS = loadStyleColors();

// Limit for direct URL tests (default: all, or set TEST_LIMIT=10 for quick validation)
const TEST_LIMIT = process.env.TEST_LIMIT
  ? parseInt(process.env.TEST_LIMIT)
  : STYLE_COLORS.length;

test.describe('Lost Sales - Planning vs. Monitoring (Direct URLs)', () => {
  // Group products by style to test efficiently
  const styleGroups = new Map<string, typeof STYLE_COLORS>();

  for (const product of STYLE_COLORS.slice(0, TEST_LIMIT)) {
    const key = `${product.department}|${product.category}|${product.class}|${product.style}`;
    if (!styleGroups.has(key)) {
      styleGroups.set(key, []);
    }
    styleGroups.get(key)!.push(product);
  }

  // Test each style-color combination
  for (const product of STYLE_COLORS.slice(0, TEST_LIMIT)) {
    const { department, category, class: className, style, color, channel, region } = product;

    test(`${style} / ${color}`, async ({ page }) => {
      // Step 1: Navigate to style's Supply Monitoring page
      const monitoringUrl = `https://${BASE_DOMAIN}/brand/${BRAND_KEY}/supply/monitoring?channel=${channel}&region=${region}&department=${encodeURIComponent(department)}&category=${encodeURIComponent(category)}&class=${encodeURIComponent(className)}&style=${encodeURIComponent(style)}`;

      console.log(`\n=== Testing: ${style} / ${color} ===`);
      console.log(`Monitoring URL: ${monitoringUrl}`);

      await page.goto(monitoringUrl);
      await page.waitForLoadState('load');

      // Wait for page to fully render (production is slower than staging)
      await page.waitForTimeout(5000);

      // Check if lost sales section exists (skip if missing entirely)
      // Only check for presence of lost sales section - "No lead time data" can appear
      // in Actions column even when lost sales data is present
      const lostSalesExists = await page.locator('text=Lost sales if you don\'t order').count() > 0;
      if (!lostSalesExists) {
        console.log(`Skipping ${style} / ${color} - No lost sales section`);
        test.skip();
        return;
      }

      // Step 2: Expand colors if button exists
      const expandButton = page.getByRole('button', { name: 'Expand colors' });
      const expandExists = await expandButton.count() > 0;

      if (expandExists) {
        console.log('Clicking "Expand colors" button...');
        await expandButton.click();
        await page.waitForTimeout(1000);
      } else {
        console.log('Colors already expanded or single color style');
      }

      // Step 3: Extract monitoring data for target color
      const monitoringData = await extractMonitoringLostSales(page, color);

      // Validate extraction
      if (monitoringData.months.length === 0) {
        // Try alternative extraction
        console.log('Primary extraction failed, trying batch extraction...');
        const allColors = await extractAllMonitoringColors(page);

        if (allColors.has(color)) {
          const data = allColors.get(color)!;
          monitoringData.months = data.months;
          monitoringData.values = data.values;
        }
      }

      expect(monitoringData.months.length, `${color}: Monitoring should show 3 months`).toBe(3);
      expect(monitoringData.values.length, `${color}: Monitoring should have 3 values`).toBe(3);

      // Step 4: Navigate to color's Planning page
      const planningUrl = `https://${BASE_DOMAIN}/brand/${BRAND_KEY}/supply/planning?channel=${channel}&region=${region}&department=${encodeURIComponent(department)}&category=${encodeURIComponent(category)}&class=${encodeURIComponent(className)}&style=${encodeURIComponent(style)}&color=${encodeURIComponent(color)}`;

      console.log(`Planning URL: ${planningUrl}`);
      await page.goto(planningUrl);
      await page.waitForLoadState('load');

      // Step 5: Extract Planning data
      const planningData = await extractPlanningLostSales(page);

      expect(planningData.headers.length, `${color}: Planning should have month headers`).toBeGreaterThan(0);
      expect(planningData.values.length, `${color}: Planning should have values`).toBeGreaterThan(0);

      // Step 6: Compare values
      const result = compareValues(monitoringData, planningData, color);

      if (result.mismatches.length > 0) {
        console.log(`\nMISMATCHES for ${style} / ${color}:`);
        result.mismatches.forEach(m => {
          console.log(`  ${m.month}: Monitoring=${m.monitoring}, Planning=${m.planning}`);
        });
      }

      expect(result.mismatches, `${style}/${color} lost sales values should match`).toHaveLength(0);
    });
  }
});
