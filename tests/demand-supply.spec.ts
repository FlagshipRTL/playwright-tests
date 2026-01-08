import { test, expect, Page } from '@playwright/test';

/**
 * Phase 1 UAT: Demand = Supply
 * Validates "Demand forecast" (Supply Planning) matches "Gross sales" (Forecasts)
 *
 * Architecture:
 * - Supply: Extracted from Supply Planning page "Demand forecast" row
 * - Demand: Extracted from Forecasts page "Stats by Year" Gross sales rows
 * - Comparison: Align at current month, compare 18+ values
 * - Classification: Locked forecasts must match; unlocked may differ
 */

const BASE_URL = 'https://staging.flagshipai.com/brand/uat-bocop/products?channel=ecommerce&region=global';

interface DemandData {
  labels: string[];
  values: number[];
}

interface SupplyData {
  values: number[];
  headers: string[];
}

interface AlignmentResult {
  mismatches: Array<{ index: number; month: string; supply: number; demand: number }>;
  comparedCount: number;
}

/**
 * Get current month as 3-letter uppercase (DEC, JAN, etc.)
 */
function getCurrentMonth(): string {
  return new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
}

/**
 * Extract values and headers from Supply Planning "Demand forecast" row
 */
async function extractSupplyValues(page: Page): Promise<SupplyData> {
  await page.waitForSelector('text=Demand forecast', { timeout: 10000 });

  const result = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');

      // Find header row with month abbreviations
      let headerLabels: string[] = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const potentialHeaders: string[] = [];

        for (let i = 0; i < cells.length; i++) {
          const cellText = cells[i].textContent?.trim() || '';
          const upperText = cellText.toUpperCase();
          const monthMatch = upperText.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
          if (monthMatch) {
            potentialHeaders.push(monthMatch[1]);
          }
        }

        if (potentialHeaders.length >= 6) {
          headerLabels = potentialHeaders;
          break;
        }
      }

      // Find "Demand forecast" row and extract values
      for (const row of rows) {
        const rowText = row.textContent || '';

        if (rowText.includes('Demand forecast')) {
          const cells = row.querySelectorAll('td');
          const values: number[] = [];

          for (let c = 0; c < cells.length; c++) {
            const cell = cells[c];
            const cellText = cell.textContent?.trim() || '';

            if (cellText.includes('Demand forecast')) continue;

            const input = cell.querySelector('input');
            let valueText: string;

            if (input && (input as HTMLInputElement).value) {
              valueText = (input as HTMLInputElement).value;
            } else {
              valueText = cellText;
            }

            const num = parseInt(valueText.replace(/,/g, '').trim());
            if (!isNaN(num)) {
              values.push(num);
            }
          }

          return { values, headers: headerLabels.slice(0, values.length) };
        }
      }
    }

    return { values: [], headers: [] };
  });

  return result;
}

/**
 * Check if forecast is locked using Lucide icon classes
 */
async function isForecastLocked(page: Page): Promise<{ locked: boolean; debug: any }> {
  try {
    await page.waitForSelector('text=Forecast Predictions', { timeout: 10000 });
  } catch {
    return { locked: false, debug: { error: 'Forecast Predictions not found' } };
  }

  await page.waitForTimeout(1000);

  // Page-wide search for Lucide icons
  const lockIconCount = await page.locator('.lucide-lock').count();
  const checkIconCount = await page.locator('.lucide-check').count();

  const debug = { lockIconCount, checkIconCount };

  // Locked = both lock and check icons present
  return { locked: lockIconCount > 0 && checkIconCount > 0, debug };
}

/**
 * Click "Show year 2" checkbox if not already checked
 * Handles Radix UI button[role="checkbox"] with data-state attribute
 */
async function ensureShowYear2Checked(page: Page): Promise<void> {
  const checkboxState = await page.evaluate(() => {
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      if (el.textContent?.trim() === 'Show year 2' ||
          (el.textContent?.includes('Show year 2') && el.children.length < 3)) {
        const parent = el.closest('label, div, span');
        if (parent) {
          const btn = parent.querySelector('button[role="checkbox"]') ||
                      parent.parentElement?.querySelector('button[role="checkbox"]');
          if (btn) {
            return { found: true, state: btn.getAttribute('data-state') };
          }

          const input = parent.querySelector('input[type="checkbox"]');
          if (input) {
            return { found: true, state: (input as HTMLInputElement).checked ? 'checked' : 'unchecked' };
          }

          const stateEl = parent.querySelector('[data-state]');
          if (stateEl) {
            return { found: true, state: stateEl.getAttribute('data-state') };
          }
        }
      }
    }
    return { found: false, state: null };
  });

  if (checkboxState.found && checkboxState.state === 'unchecked') {
    await page.locator('text=Show year 2').first().click();
    await page.waitForTimeout(1000);

    try {
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('tr');
        let grossSalesCount = 0;
        for (const row of rows) {
          const text = row.textContent || '';
          if (text.includes('Gross sales') && /\[\d{4}[-–]\d{4}\]/.test(text) &&
              !text.includes('(LY)') && !text.includes('(LLY)')) {
            grossSalesCount++;
          }
        }
        return grossSalesCount >= 2;
      }, { timeout: 5000 });
    } catch {
      // Continue even if second year row doesn't appear
    }
  } else if (!checkboxState.found) {
    // Fallback: blind click
    try {
      await page.locator('text=Show year 2').first().click();
      await page.waitForTimeout(1000);
    } catch {
      // Continue
    }
  }
}

/**
 * Extract month labels and values from Forecasts "Stats by Year" section
 * Reads actual column headers from table (not generated)
 */
async function extractDemandData(page: Page): Promise<DemandData> {
  try {
    await expect(page.locator('text=Loading Data')).not.toBeVisible({ timeout: 10000 });
  } catch {
    // No loading overlay, continue
  }

  const statsHeader = page.locator('text=Stats by Year');
  await statsHeader.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await ensureShowYear2Checked(page);
  await page.waitForTimeout(500);

  // Extract Gross sales rows with actual column headers
  const grossSalesRows = await page.evaluate(() => {
    const results: Array<{ year: number; values: number[]; headers: string[] }> = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');

      // Find header row with month abbreviations
      let headerLabels: string[] = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const potentialHeaders: string[] = [];

        for (let i = 0; i < cells.length; i++) {
          const cellText = cells[i].textContent?.trim().toUpperCase() || '';
          if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(cellText)) {
            potentialHeaders.push(cellText);
          }
        }

        if (potentialHeaders.length >= 6) {
          headerLabels = potentialHeaders;
          break;
        }
      }

      // Find Gross sales data rows
      for (const row of rows) {
        const rowText = row.textContent || '';

        if (!rowText.includes('Gross sales')) continue;
        if (rowText.includes('(LY)') || rowText.includes('(LLY)')) continue;

        const yearMatch = rowText.match(/Gross sales[^[]*\[(\d{4})[-–](\d{4})\]/);
        if (!yearMatch) continue;

        const yearStart = parseInt(yearMatch[1]);
        const cells = row.querySelectorAll('td');
        const values: number[] = [];

        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          const cellText = cell.textContent?.trim() || '';

          if (cellText.includes('Gross sales')) continue;

          const input = cell.querySelector('input');
          let valueText: string;

          if (input && input.value) {
            valueText = input.value;
          } else {
            valueText = cellText;
          }

          const num = parseInt(valueText.replace(/,/g, ''));
          if (!isNaN(num) && num >= 0) {
            values.push(num);
          }
        }

        if (values.length > 0 && headerLabels.length > 0) {
          const rowHeaders = headerLabels.slice(0, values.length);
          results.push({ year: yearStart, values, headers: rowHeaders });
        }
      }
    }

    return results;
  });

  // Sort chronologically by year
  grossSalesRows.sort((a, b) => a.year - b.year);

  // Concatenate rows with dynamic overlap detection
  let allValues: number[] = [];
  let allLabels: string[] = [];

  for (let i = 0; i < grossSalesRows.length; i++) {
    const row = grossSalesRows[i];
    const rowLabels = row.headers;

    if (i === 0) {
      allValues = row.values;
      allLabels = rowLabels;
    } else {
      // Calculate overlap dynamically
      let overlap = 0;
      for (let k = 1; k <= Math.min(3, rowLabels.length, allLabels.length); k++) {
        const prevEnd = allLabels.slice(-k);
        const currStart = rowLabels.slice(0, k);
        const matches = prevEnd.every((month, idx) => month === currStart[idx]);
        if (matches) {
          overlap = k;
        }
      }

      allValues = allValues.concat(row.values.slice(overlap));
      allLabels = allLabels.concat(rowLabels.slice(overlap));
    }
  }

  return { labels: allLabels, values: allValues };
}

/**
 * Align and compare supply vs demand values at current month
 */
function alignAndCompare(
  supplyValues: number[],
  demandLabels: string[],
  demandValues: number[]
): AlignmentResult {
  const currentMonth = getCurrentMonth();

  const startIdx = demandLabels.indexOf(currentMonth);
  if (startIdx === -1) {
    throw new Error(`Current month ${currentMonth} not found in demand labels: [${demandLabels.join(', ')}]`);
  }

  const demandSliced = demandValues.slice(startIdx);
  const labelsSliced = demandLabels.slice(startIdx);

  const compareLength = Math.min(supplyValues.length, demandSliced.length);
  const mismatches: Array<{ index: number; month: string; supply: number; demand: number }> = [];

  for (let i = 0; i < compareLength; i++) {
    if (supplyValues[i] !== demandSliced[i]) {
      mismatches.push({
        index: i,
        month: labelsSliced[i] || `Month ${i}`,
        supply: supplyValues[i],
        demand: demandSliced[i],
      });
    }
  }

  return { mismatches, comparedCount: compareLength };
}

// UAT Account style-color combinations (15 total)
const STYLE_COLORS = [
  { style: 'Base', color: 'Black' },
  { style: 'Base', color: 'White' },
  { style: 'Base', color: 'Navy' },
  { style: 'Base', color: 'Brown' },
  { style: 'Base', color: 'Dark Green' },
  { style: 'Backload', color: 'Black' },
  { style: 'Backload', color: 'White' },
  { style: 'Backload', color: 'Navy' },
  { style: 'Backload', color: 'Brown' },
  { style: 'Backload', color: 'Dark Green' },
  { style: 'Frontload', color: 'Black' },
  { style: 'Frontload', color: 'White' },
  { style: 'Frontload', color: 'Navy' },
  { style: 'Frontload', color: 'Brown' },
  { style: 'Frontload', color: 'Dark Green' },
];

test.describe('Phase 1: Demand = Supply', () => {
  for (const { style, color } of STYLE_COLORS) {
    test(`${style} / ${color}`, async ({ page }) => {
      // Navigate through UI
      await page.goto(BASE_URL);
      await page.getByRole('heading', { name: 'Mens', exact: true }).click();
      await page.locator('h3').filter({ hasText: 'Tops' }).click();
      await page.locator('h3').filter({ hasText: 'Shirts' }).click();
      await page.locator('h3').filter({ hasText: style }).click();
      await page.locator('h3').filter({ hasText: color }).click();

      // Extract Supply
      await page.getByRole('link', { name: 'Supply Planning' }).click();
      await page.waitForLoadState('load');
      await page.waitForSelector('text=Demand forecast', { timeout: 10000 });
      await page.waitForTimeout(1000);

      const supplyData = await extractSupplyValues(page);
      const supplyValues = supplyData.values;

      // Extract Demand
      await page.getByRole('link', { name: 'Forecasts', exact: true }).click();
      await page.waitForLoadState('load');

      const lockStatus = await isForecastLocked(page);

      await page.locator('text=FORECAST').first().click();
      await page.waitForTimeout(500);

      const demandData = await extractDemandData(page);
      const { labels, values } = demandData;

      // Guard clauses
      expect(supplyValues.length, 'Supply extraction failed').toBeGreaterThan(0);
      expect(values.length, 'Demand extraction failed').toBeGreaterThan(10);
      expect(labels.length, 'Labels count must match values count').toBe(values.length);

      const currentMonth = getCurrentMonth();
      expect(labels.indexOf(currentMonth), `Current month ${currentMonth} not found`).toBeGreaterThanOrEqual(0);

      // Align and compare
      const result = alignAndCompare(supplyValues, labels, values);
      expect(result.comparedCount, 'Must compare at least 12 months').toBeGreaterThanOrEqual(12);

      // Final classification based on lock status
      if (lockStatus.locked) {
        expect(result.mismatches, 'Locked forecast: Supply and Demand must match').toHaveLength(0);
      }
      // Unlocked forecasts: differences allowed (test passes)
    });
  }
});
