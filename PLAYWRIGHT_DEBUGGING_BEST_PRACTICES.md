# Playwright Debugging Best Practices for Dynamic Content & Failing Selectors

## Table of Contents
1. [Diagnostic Techniques for Empty Extraction](#1-diagnostic-techniques-for-empty-extraction)
2. [Senior Dev Tips for Dynamic Content](#2-senior-dev-tips-for-dynamic-content)
3. [React/Next.js RSC Specific Issues](#3-reactnextjs-rsc-specific-issues)
4. [Self-Diagnosing Tests](#4-self-diagnosing-tests)

---

## 1. Diagnostic Techniques for Empty Extraction

### 1.1 Programmatic DOM Structure Inspection

When selectors fail, inspect the actual DOM structure programmatically:

```typescript
// Diagnostic helper: Inspect what's actually in the DOM
test('diagnose empty extraction', async ({ page }) => {
  await page.goto('/brand/product');

  // Capture full DOM structure around target area
  const domStructure = await page.evaluate(() => {
    const container = document.querySelector('.product-details');
    if (!container) return { error: 'Container not found' };

    return {
      html: container.outerHTML,
      textContent: container.textContent,
      childCount: container.children.length,
      classes: Array.from(container.classList),
      attributes: Array.from(container.attributes).map(attr => ({
        name: attr.name,
        value: attr.value
      })),
      children: Array.from(container.children).map(child => ({
        tag: child.tagName,
        classes: Array.from(child.classList),
        text: child.textContent?.trim().substring(0, 100)
      }))
    };
  });

  console.log('DOM Structure:', JSON.stringify(domStructure, null, 2));
});
```

### 1.2 Screenshot + HTML Snapshot Combo

Capture both visual and structural state when extraction fails:

```typescript
test('capture diagnostic artifacts on failure', async ({ page }) => {
  await page.goto('/brand/product');

  try {
    // Attempt extraction
    const price = await page.locator('[data-testid="price"]').textContent();
    expect(price).toBeTruthy();
  } catch (error) {
    // Capture diagnostics
    await page.screenshot({
      path: `./diagnostics/failed-${Date.now()}.png`,
      fullPage: true
    });

    const html = await page.content();
    await fs.writeFile(
      `./diagnostics/failed-${Date.now()}.html`,
      html
    );

    // Capture computed styles of target element
    const styles = await page.locator('[data-testid="price"]').evaluate(el => {
      if (!el) return null;
      const computed = window.getComputedStyle(el);
      return {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        position: computed.position,
        width: computed.width,
        height: computed.height
      };
    });

    console.log('Element styles:', styles);
    throw error;
  }
});
```

### 1.3 Using Trace Viewer (Always Enabled in CI)

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    trace: 'retain-on-failure', // Capture traces only on failures
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});

// View traces after failures:
// npx playwright show-trace trace.zip
```

### 1.4 Deep Element Inspection Utility

```typescript
// utils/diagnostics.ts
export async function inspectElement(
  page: Page,
  selector: string
): Promise<ElementDiagnostics> {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel);

    if (!element) {
      return {
        found: false,
        selector: sel,
        documentState: document.readyState,
        bodyChildren: document.body.children.length
      };
    }

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    return {
      found: true,
      selector: sel,
      tag: element.tagName,
      text: element.textContent?.trim(),
      html: element.outerHTML.substring(0, 500),
      attributes: Object.fromEntries(
        Array.from(element.attributes).map(a => [a.name, a.value])
      ),
      position: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        inViewport: rect.top >= 0 && rect.left >= 0
      },
      computed: {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        zIndex: computed.zIndex
      },
      parentChain: getParentChain(element)
    };
  }, selector);
}

function getParentChain(el: Element): string[] {
  const chain: string[] = [];
  let current = el.parentElement;
  while (current && chain.length < 5) {
    chain.push(`${current.tagName}.${Array.from(current.classList).join('.')}`);
    current = current.parentElement;
  }
  return chain;
}
```

---

## 2. Senior Dev Tips for Dynamic Content

### 2.1 Handling Variable UI Across Brands/Tenants

**Problem:** Different brands have different layouts, some show price, some don't.

**Solution:** Conditional extraction with diagnostic fallbacks

```typescript
interface BrandConfig {
  brandId: string;
  priceSelector: string[];
  fallbackSelectors: string[];
  hasPrice: boolean;
}

const brandConfigs: BrandConfig[] = [
  {
    brandId: 'brand-a',
    priceSelector: ['[data-testid="price"]', '.product-price', '.price'],
    fallbackSelectors: ['[data-price]', 'span:has-text("$")'],
    hasPrice: true
  },
  {
    brandId: 'brand-b',
    priceSelector: [],
    fallbackSelectors: [],
    hasPrice: false
  }
];

async function extractPrice(page: Page, brandId: string): Promise<string | null> {
  const config = brandConfigs.find(c => c.brandId === brandId);

  if (!config?.hasPrice) {
    console.log(`Brand ${brandId} does not display prices - skipping`);
    return null;
  }

  // Try primary selectors
  for (const selector of config.priceSelector) {
    const element = page.locator(selector).first();
    if (await element.count() > 0 && await element.isVisible()) {
      const text = await element.textContent();
      if (text?.trim()) {
        console.log(`✓ Price found via ${selector}: ${text}`);
        return text.trim();
      }
    }
  }

  // Try fallback selectors
  for (const selector of config.fallbackSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      const text = await element.textContent();
      console.log(`⚠ Price found via FALLBACK ${selector}: ${text}`);
      return text?.trim() || null;
    }
  }

  // Diagnostic: What's actually on the page?
  const diagnostic = await page.evaluate(() => {
    const priceTexts = Array.from(document.body.querySelectorAll('*'))
      .filter(el => {
        const text = el.textContent || '';
        return /\$\d+/.test(text) && el.children.length === 0;
      })
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent?.trim().substring(0, 50)
      }));
    return priceTexts;
  });

  console.error(`✗ Price not found for ${brandId}. Found $ elements:`, diagnostic);
  return null;
}
```

### 2.2 Robust Selector Strategies for Variable Layouts

**Best Practice Hierarchy (2026):**

1. **Role-based selectors** (survive layout changes)
2. **data-testid** attributes (decouple from UI structure)
3. **Text content** (semantic, but can change)
4. **CSS classes** (fragile, avoid)

```typescript
// GOOD: Role-based + fallbacks
async function robustExtract(page: Page, fieldName: string) {
  const strategies = [
    // Strategy 1: Accessible role + name
    () => page.getByRole('heading', { name: fieldName }),

    // Strategy 2: data-testid
    () => page.locator(`[data-testid="${fieldName}"]`),

    // Strategy 3: Semantic HTML + text
    () => page.locator(`label:has-text("${fieldName}") + span`),

    // Strategy 4: Flexible text search
    () => page.locator(`text=${fieldName}`).locator('..').locator('span').first()
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const locator = strategies[i]();
      await locator.waitFor({ timeout: 2000 });
      const text = await locator.textContent();
      if (text?.trim()) {
        console.log(`✓ ${fieldName} found via strategy ${i + 1}`);
        return text.trim();
      }
    } catch (e) {
      continue;
    }
  }

  // None worked - diagnose
  console.error(`✗ All strategies failed for "${fieldName}"`);
  const available = await page.evaluate((field) => {
    return Array.from(document.body.querySelectorAll('*'))
      .filter(el => el.textContent?.includes(field))
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.substring(0, 50),
        selector: el.className ? `.${el.className.split(' ')[0]}` : el.tagName
      }))
      .slice(0, 5);
  }, fieldName);

  console.log('Available elements containing field name:', available);
  return null;
}
```

### 2.3 Multi-Tenant Testing Pattern

```typescript
// fixtures/multi-tenant.ts
export const test = base.extend<{ tenantConfig: TenantConfig }>({
  tenantConfig: async ({ page }, use, testInfo) => {
    const tenantId = testInfo.project.name; // e.g., 'brand-a', 'brand-b'
    const config = loadTenantConfig(tenantId);

    // Set tenant-specific viewport
    await page.setViewportSize(config.viewport);

    // Set tenant-specific cookies/auth
    await page.context().addCookies(config.cookies);

    await use(config);
  }
});

// Define tenant-specific projects in playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'brand-a',
      use: {
        baseURL: 'https://brand-a.com',
        storageState: 'auth/brand-a.json'
      }
    },
    {
      name: 'brand-b',
      use: {
        baseURL: 'https://brand-b.com',
        storageState: 'auth/brand-b.json'
      }
    }
  ]
});
```

---

## 3. React/Next.js RSC Specific Issues

### 3.1 Hydration Timing Problems

**Issue:** Playwright clicks before event handlers attach, or extracts before client-side data loads.

**Solution:** Wait for hydration completion

```typescript
// utils/hydration.ts
export async function waitForHydration(page: Page) {
  // Method 1: Wait for Next.js hydration class
  await page.waitForSelector('body:not(.is-loading)', {
    timeout: 10000
  });

  // Method 2: Wait for React hydration indicator
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      if (document.querySelector('[data-hydrated="true"]')) {
        resolve();
        return;
      }

      // Poll for hydration
      const interval = setInterval(() => {
        const isHydrated = document.querySelector('[data-hydrated="true"]') ||
                          // React 18 hydration marker
                          document.body.dataset.reactHydrated === 'true';

        if (isHydrated) {
          clearInterval(interval);
          resolve();
        }
      }, 100);

      // Timeout after 10s
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 10000);
    });
  });
}

// Method 3: Wait for network idle (RSC payloads complete)
export async function waitForRSCLoad(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // Extra buffer for React to process RSC payload
  await page.waitForTimeout(500);
}
```

### 3.2 Dynamic Content Rendering

**Issue:** Server renders placeholder, client fills in real data.

```typescript
test('extract after client-side update', async ({ page }) => {
  await page.goto('/product/123');

  // Wait for initial render
  await page.waitForLoadState('domcontentloaded');

  // Wait for hydration
  await waitForHydration(page);

  // Wait for specific data to load (not placeholder)
  const priceLocator = page.locator('[data-testid="price"]');

  // Wait for non-placeholder value
  await priceLocator.waitFor({ state: 'visible' });

  // Verify not loading state
  await expect(priceLocator).not.toHaveText(/loading|\.\.\.|\$0\.00/i);

  // Wait for actual price to appear
  await expect(priceLocator).toHaveText(/\$\d+\.\d{2}/);

  const price = await priceLocator.textContent();
  console.log('Final price:', price);
});
```

### 3.3 Detecting RSC Hydration State

```typescript
// Add to your Next.js layout or root component
// app/layout.tsx
'use client';

useEffect(() => {
  document.body.dataset.reactHydrated = 'true';
}, []);

// Then in Playwright tests:
async function waitForClientHydration(page: Page) {
  await page.waitForFunction(
    () => document.body.dataset.reactHydrated === 'true',
    { timeout: 10000 }
  );
}
```

### 3.4 Handling React Suspense Boundaries

```typescript
async function waitForSuspenseResolution(page: Page, selector: string) {
  const locator = page.locator(selector);

  // Wait for element to exist
  await locator.waitFor({ state: 'attached', timeout: 5000 });

  // Wait for suspense fallback to be replaced
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      // Check if parent has suspense fallback
      const hasFallback = el.closest('[data-suspense-fallback]') !== null;
      return !hasFallback;
    },
    selector,
    { timeout: 10000 }
  );

  return locator;
}
```

---

## 4. Self-Diagnosing Tests

### 4.1 Tests That Report What They Found vs Expected

```typescript
interface ExtractionResult {
  field: string;
  expected: string | RegExp;
  found: string | null;
  success: boolean;
  attempts: string[];
  recommendation: string;
}

async function diagnoseExtraction(
  page: Page,
  field: string,
  selectors: string[],
  expectedPattern?: RegExp
): Promise<ExtractionResult> {
  const attempts: string[] = [];
  let found: string | null = null;

  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      const count = await element.count();

      if (count === 0) {
        attempts.push(`❌ ${selector}: element not found`);
        continue;
      }

      const isVisible = await element.isVisible().catch(() => false);
      if (!isVisible) {
        attempts.push(`⚠️  ${selector}: found but not visible`);
        continue;
      }

      const text = await element.textContent();
      found = text?.trim() || null;

      if (!found) {
        attempts.push(`⚠️  ${selector}: found but empty text`);
        continue;
      }

      if (expectedPattern && !expectedPattern.test(found)) {
        attempts.push(`⚠️  ${selector}: found "${found}" but doesn't match ${expectedPattern}`);
        continue;
      }

      attempts.push(`✅ ${selector}: success - "${found}"`);
      break;

    } catch (error) {
      attempts.push(`❌ ${selector}: error - ${error.message}`);
    }
  }

  const success = found !== null && (!expectedPattern || expectedPattern.test(found));

  let recommendation = '';
  if (!success) {
    if (attempts.every(a => a.includes('not found'))) {
      recommendation = 'Element likely missing from DOM. Check if page loaded correctly or if selector patterns are incorrect.';
    } else if (attempts.some(a => a.includes('not visible'))) {
      recommendation = 'Element exists but not visible. Check CSS display/visibility or wait for animations.';
    } else if (attempts.some(a => a.includes('empty text'))) {
      recommendation = 'Element exists but has no text. May need to wait for client-side data load.';
    } else {
      recommendation = 'Text found but doesn\'t match expected pattern. Verify expected pattern is correct.';
    }
  }

  return {
    field,
    expected: expectedPattern?.toString() || 'any non-empty',
    found,
    success,
    attempts,
    recommendation
  };
}

// Usage in test:
test('self-diagnosing extraction', async ({ page }) => {
  await page.goto('/product/123');
  await waitForHydration(page);

  const priceResult = await diagnoseExtraction(
    page,
    'price',
    ['[data-testid="price"]', '.price', '[data-price]'],
    /\$\d+\.\d{2}/
  );

  console.log('\n=== EXTRACTION DIAGNOSIS ===');
  console.log(`Field: ${priceResult.field}`);
  console.log(`Expected: ${priceResult.expected}`);
  console.log(`Found: ${priceResult.found || 'NULL'}`);
  console.log(`Success: ${priceResult.success ? '✅' : '❌'}`);
  console.log('\nAttempts:');
  priceResult.attempts.forEach(a => console.log(`  ${a}`));
  if (!priceResult.success) {
    console.log(`\n💡 Recommendation: ${priceResult.recommendation}`);
  }
  console.log('===========================\n');

  expect(priceResult.success).toBeTruthy();
});
```

### 4.2 Automatic DOM Structure Logging on Failure

```typescript
// test-setup.ts
import { test as base } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    // Wrap page with auto-diagnostics
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, options);

      // Auto-capture page structure after navigation
      if (process.env.DEBUG_SELECTORS) {
        const structure = await page.evaluate(() => {
          return {
            title: document.title,
            bodyClasses: Array.from(document.body.classList),
            mainSections: Array.from(document.querySelectorAll('[class*="section"], [class*="container"], main, article')).map(el => ({
              tag: el.tagName,
              classes: Array.from(el.classList).slice(0, 3),
              childCount: el.children.length
            }))
          };
        });
        console.log('Page structure:', JSON.stringify(structure, null, 2));
      }

      return response;
    };

    await use(page);

    // On test failure, capture diagnostics
    if (testInfo.status === 'failed') {
      const diagnostics = await page.evaluate(() => {
        return {
          url: window.location.href,
          readyState: document.readyState,
          bodyText: document.body.innerText.substring(0, 500),
          visibleElements: Array.from(document.querySelectorAll('*'))
            .filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .length,
          dataTestIds: Array.from(document.querySelectorAll('[data-testid]'))
            .map(el => el.getAttribute('data-testid'))
        };
      });

      await testInfo.attach('dom-diagnostics', {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json'
      });
    }
  }
});
```

### 4.3 Comprehensive Diagnostic Helper

```typescript
// utils/comprehensive-diagnostics.ts
export async function captureComprehensiveDiagnostics(
  page: Page,
  testName: string
): Promise<void> {
  const timestamp = Date.now();
  const dir = `./diagnostics/${testName}-${timestamp}`;
  await fs.mkdir(dir, { recursive: true });

  // 1. Screenshot
  await page.screenshot({
    path: `${dir}/screenshot.png`,
    fullPage: true
  });

  // 2. HTML snapshot
  const html = await page.content();
  await fs.writeFile(`${dir}/page.html`, html);

  // 3. DOM structure analysis
  const domAnalysis = await page.evaluate(() => {
    const analyze = (el: Element, depth = 0): any => {
      if (depth > 3) return null;

      return {
        tag: el.tagName,
        id: el.id || undefined,
        classes: Array.from(el.classList),
        testId: el.getAttribute('data-testid') || undefined,
        text: Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent?.trim())
          .filter(Boolean)
          .join(' ')
          .substring(0, 50),
        children: Array.from(el.children)
          .map(child => analyze(child, depth + 1))
          .filter(Boolean)
      };
    };

    return {
      body: analyze(document.body),
      dataTestIds: Array.from(document.querySelectorAll('[data-testid]'))
        .map(el => ({
          testId: el.getAttribute('data-testid'),
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 50),
          visible: el.getBoundingClientRect().width > 0
        }))
    };
  });

  await fs.writeFile(
    `${dir}/dom-analysis.json`,
    JSON.stringify(domAnalysis, null, 2)
  );

  // 4. Network log
  const networkLog = await page.evaluate(() => {
    return (window as any).__networkLog || [];
  });
  await fs.writeFile(
    `${dir}/network.json`,
    JSON.stringify(networkLog, null, 2)
  );

  // 5. Console log
  const consoleLog = await page.evaluate(() => {
    return (window as any).__consoleLog || [];
  });
  await fs.writeFile(
    `${dir}/console.json`,
    JSON.stringify(consoleLog, null, 2)
  );

  console.log(`\n📊 Comprehensive diagnostics saved to: ${dir}\n`);
}
```

---

## Quick Reference: Decision Tree

```
Selector failed?
│
├─ Element not found in DOM?
│  ├─ Use: inspectElement() to see if element exists
│  ├─ Use: page.evaluate() to search for similar elements
│  └─ Check: DOM snapshot in trace viewer
│
├─ Element found but empty?
│  ├─ Check: hydration timing (waitForHydration)
│  ├─ Check: RSC payload completion (waitForRSCLoad)
│  └─ Use: diagnoseExtraction() to see extraction attempts
│
├─ Element found but not visible?
│  ├─ Check: CSS computed styles (display, visibility, opacity)
│  ├─ Check: element position (in viewport?)
│  └─ Use: screenshot + HTML snapshot combo
│
└─ Works for some brands but not others?
   ├─ Use: Multi-tenant testing pattern
   ├─ Use: Robust selector strategies (role-based + fallbacks)
   └─ Use: Self-diagnosing extraction with recommendations
```

---

## Sources

- [Playwright Debug: A Complete Guide](https://autify.com/blog/playwright-debug)
- [15 Playwright Selector Best Practices in 2026 | BrowserStack](https://www.browserstack.com/guide/playwright-selectors-best-practices)
- [Debugging Tests | Playwright](https://playwright.dev/docs/debug)
- [Debugging Playwright Tests: A Comprehensive Guide | Medium](https://medium.com/@anandpak108/debugging-playwright-tests-a-comprehensive-guide-with-examples-9647c2dd9248)
- [Trace viewer | Playwright](https://playwright.dev/docs/trace-viewer)
- [Snapshot Testing with Playwright in 2026 | BrowserStack](https://www.browserstack.com/guide/playwright-snapshot-testing)
- [The Ultimate Guide to Playwright Trace Viewer | Momentic](https://momentic.ai/blog/the-ultimate-guide-to-playwright-trace-viewer-master-time-travel-debugging)
- [Handling hydration-related errors | Playwright GitHub Issue](https://github.com/microsoft/playwright/issues/27759)
- [Wait for Single Page Navigation and Re-hydration with Playwright](https://lab.amalitsky.com/posts/2022/wait-for-single-page-navigation-and-re-hydration-playwright-react/)
- [Mastering Playwright Test Automation | Medium](https://medium.com/@rajasekaran.parthiban7/mastering-playwright-test-automation-from-flaky-tests-to-confident-deployments-10261f1459c9)
- [Scaling Your Playwright Tests: Multi-User, Multi-Context | DEV](https://dev.to/gustavomeilus/scaling-your-playwright-tests-a-fixture-for-multi-user-multi-context-worlds-53i4)
- [Zero-Maintenance Playwright Tests with data-testid | SourceFuse](https://www.sourcefuse.com/resources/blog/zero-maintenance-playwright-tests-how-centralized-data-testid-makes-ui-automation-robust/)
- [Playwright Locators: Best Practices | Bondar Academy](https://www.bondaracademy.com/blog/playwright-locators-best-practices)
- [Best Practices | Playwright](https://playwright.dev/docs/best-practices)
