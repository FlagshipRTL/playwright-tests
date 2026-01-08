import { test } from '@playwright/test';

/**
 * Diagnostic test to inspect page structure
 * Helps debug extraction failures by showing actual DOM structure
 */

test('Diagnostic: Inspect Ponya Jacket Monitoring Page', async ({ page }) => {
  const url = 'https://staging.flagshipai.com/brand/industry-of-all-nations/supply/monitoring?department=Apparel&category=Outerwear&class=Jacket&style=Ponya+Jacket&channel=ecommerce&region=global';

  await page.goto(url);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  // Screenshot BEFORE expansion
  await page.screenshot({ path: 'diagnostic-before-expand.png', fullPage: true });

  // Click the carrot to expand colors (looks for "9 colors" or similar pattern)
  const expandCarrot = page.locator('text=/\\d+ colors?/').locator('..');
  const carrotExists = await expandCarrot.count() > 0;
  console.log(`\nExpand carrot found: ${carrotExists}`);

  if (carrotExists) {
    await expandCarrot.click();
    await page.waitForTimeout(1000);
  }

  // Screenshot AFTER expansion
  await page.screenshot({ path: 'diagnostic-after-expand.png', fullPage: true });

  // Diagnostic 1: Find all month-like text elements
  const monthElements = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    const monthPattern = /^(June|July|August|May|JUN|JUL|AUG|MAY)$/i;

    return allElements
      .filter(el => monthPattern.test(el.textContent?.trim() || ''))
      .slice(0, 30)
      .map((el, idx) => ({
        index: idx,
        tag: el.tagName,
        text: el.textContent?.trim(),
        className: el.className,
        nextSibling: el.nextElementSibling?.textContent?.trim().slice(0, 50),
        parent: el.parentElement?.tagName
      }));
  });

  console.log('\n=== MONTH ELEMENTS FOUND ===');
  console.log(JSON.stringify(monthElements, null, 2));

  // Diagnostic 2: Find all color link elements
  const colorLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .filter(a => {
        const text = a.textContent?.trim();
        return text && text.length > 2 && text.length < 30;
      })
      .slice(0, 20)
      .map(a => a.textContent?.trim());
  });

  console.log('\n=== COLOR LINKS FOUND ===');
  console.log(JSON.stringify(colorLinks, null, 2));

  // Diagnostic 3: Check h4 structure specifically
  const h4Structure = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h4')).map((h4, idx) => ({
      index: idx,
      text: h4.textContent?.trim(),
      nextSibling: h4.nextElementSibling?.textContent?.trim(),
      parent: h4.parentElement?.className?.slice(0, 50)
    }));
  });

  console.log('\n=== H4 STRUCTURE ===');
  console.log(JSON.stringify(h4Structure, null, 2));

  // Diagnostic 4: Find "Lost sales" text and nearby structure
  const lostSalesContext = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    const lostSalesElements = allElements.filter(el =>
      el.textContent?.includes('Lost sales')
    );

    return lostSalesElements.slice(0, 5).map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim().slice(0, 100),
      children: Array.from(el.children).slice(0, 10).map(child => ({
        tag: child.tagName,
        text: child.textContent?.trim().slice(0, 50)
      }))
    }));
  });

  console.log('\n=== LOST SALES CONTEXT ===');
  console.log(JSON.stringify(lostSalesContext, null, 2));

  // Diagnostic 5: Page title and breadcrumbs
  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    breadcrumbs: Array.from(document.querySelectorAll('[role="navigation"] a, nav a'))
      .map(a => a.textContent?.trim())
      .filter(t => t)
  }));

  console.log('\n=== PAGE INFO ===');
  console.log(JSON.stringify(pageInfo, null, 2));

  // Diagnostic 6: Find color names and their structure
  const colorStructure = await page.evaluate(() => {
    const colorNames = ['Indigo 12', 'Acacia', 'Iron 8', 'Indian Forest', 'Undyed'];

    return colorNames.map(colorName => {
      const elements = Array.from(document.querySelectorAll('*'));
      const colorEl = elements.find(el => el.textContent?.trim() === colorName);

      if (!colorEl) return { color: colorName, found: false };

      // Find nearby month/value elements
      const container = colorEl.closest('div');
      const allH4 = container ? Array.from(container.querySelectorAll('h4, h3, h2, p, span')) : [];

      return {
        color: colorName,
        found: true,
        tag: colorEl.tagName,
        containerHTML: container?.innerHTML.slice(0, 500),
        nearbyElements: allH4.slice(0, 10).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 30)
        }))
      };
    });
  });

  console.log('\n=== COLOR STRUCTURE ===');
  console.log(JSON.stringify(colorStructure, null, 2));

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
  console.log('Check output above to understand page structure');
});
