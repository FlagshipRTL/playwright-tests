# Lost Sales Test - Technical Guide

Technical documentation for the Lost Sales - Planning vs. Monitoring validation test.

---

## Test Purpose

Validates data consistency between two pages:
- **Supply Monitoring:** Shows "Lost sales if you don't order" (3 months displayed)
- **Supply Planning:** Shows "Potential Lost Sales" row (18-month time series)

**Requirement:** Monitoring values must match the corresponding months in Planning.

---

## Test Architecture

### Flow

1. **Navigate to style's Supply Monitoring page**
   - URL: `https://staging.flagshipai.com/brand/{brand}/supply/monitoring?department={dept}&category={cat}&class={class}&style={style}&channel={channel}&region={region}`

2. **Expand colors** (if button exists)
   - Some brands show colors pre-expanded
   - Others have "Expand colors" button

3. **Extract lost sales from Monitoring**
   - Find color link: `<a href*="color={color}">`
   - Get parent `<tr>` (table row)
   - Extract `<h4>` month headings + values from nextSibling
   - Returns: `{ months: ['JUL', 'AUG', 'SEP'], values: [4, 8, 4] }`

4. **Navigate to color's Planning page**
   - URL: `{monitoring_url}&color={color}` → replace `/monitoring` with `/planning`

5. **Extract Potential Lost Sales from Planning**
   - Find `<th>` containing "Potential Lost Sales"
   - Get parent `<tr>`
   - Extract `<button>` values
   - Find month headers from StaticText elements matching "MMM YYYY" pattern
   - Returns: `{ headers: ['JAN', 'FEB', ..., 'JUN'], values: [0, 0, 1, 3, 1, 6, ...] }`

6. **Compare**
   - For each Monitoring month (JUL, AUG, SEP)
   - Find that month in Planning headers
   - Compare values
   - Log mismatches

---

## Key Functions

### `extractMonitoringLostSales(page, colorName)`

**Purpose:** Extract lost sales for a specific color from expanded Monitoring page

**Algorithm:**
1. Find `<a>` with `href*="color={colorName}"`
2. Use `closest('tr')` to get table row
3. Find `<h4>` elements with month names (JULY, AUGUST, etc.)
4. Extract value from `h4.nextElementSibling`
5. Normalize month names (JULY → JUL)
6. Return first 3 months found

**Edge cases:**
- Color order varies by style → dynamically detect from DOM
- Fallback: sibling traversal if `<tr>` structure differs

---

### `extractAllMonitoringColors(page)`

**Purpose:** Extract all colors at once (more reliable than per-color extraction)

**Algorithm:**
1. Find all `<a href*="supply/planning" href*="color=">`
2. For each link:
   - Get parent `<tr>`
   - Find `<h4>` month headings in that row
   - Extract values
3. Return `Map<colorName, {months, values}>`

**Why this is better:**
- Single page traversal (faster)
- Consistent month detection
- Used as fallback when single-color extraction fails

---

### `extractPlanningLostSales(page)`

**Purpose:** Extract Potential Lost Sales row from Planning page

**Algorithm:**
1. Find all elements matching "MMM YYYY" pattern (e.g., "JAN 2026")
2. Extract month part only (JAN)
3. Deduplicate using Set (avoid nested element duplicates)
4. Find `<th>` containing "Potential Lost Sales" (exclude "Replenishment Lost Sales")
5. Get parent `<tr>`
6. Extract all `<button>` values in that row
7. Return first 18 headers + values

**Edge cases:**
- Planning shows 18+ months (only take first 18)
- Buttons contain formatted numbers ("1,234" → parse to 1234)
- Multiple "Lost Sales" rows (filter by exact text match)

---

### `compareValues(monitoring, planning, colorName)`

**Purpose:** Compare Monitoring values against Planning time series

**Algorithm:**
1. For each Monitoring month (e.g., JUL)
2. Find that month in Planning headers array (`indexOf`)
3. Compare `monitoring.values[i]` vs `planning.values[planningIndex]`
4. Collect mismatches
5. Return `{ match: boolean, mismatches: [...] }`

**Important:** Uses **first occurrence** of month in Planning headers (handles fiscal year wraparound correctly).

---

## Page Structure

### Supply Monitoring (Expanded Colors)

```html
<table>
  <tr> <!-- Style-level row -->
    <a href="/supply/planning?style=Base">Base</a>
    <h4>July</h4> <span>21</span>
    <h4>August</h4> <span>34</span>
    <h4>September</h4> <span>18</span>
  </tr>
  <tr> <!-- Color-level row -->
    <a href="/supply/planning?style=Base&color=Black">Black</a>
    <h4>July</h4> <span>4</span>
    <h4>August</h4> <span>8</span>
    <h4>September</h4> <span>4</span>
  </tr>
  <tr> <!-- Another color -->
    <a href="/supply/planning?style=Base&color=White">White</a>
    <h4>July</h4> <span>6</span>
    ...
  </tr>
</table>
```

**Critical:** Must use `closest('tr')` to isolate color row, not `closest('[class*="grid"]')` which spans all rows.

---

### Supply Planning

```html
<table>
  <thead>
    <tr>
      <th></th>
      <th>JAN 2026</th>
      <th>FEB 2026</th>
      <th>MAR 2026</th>
      ...
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>Demand forecast</th>
      <td><button>564</button></td>
      <td><button>472</button></td>
      ...
    </tr>
    <tr>
      <th>Potential Lost Sales</th>
      <td><button>3</button></td>
      <td><button>4</button></td>
      ...
    </tr>
  </tbody>
</table>
```

**Critical:** Find `<th>` containing "Potential Lost Sales", use `closest('tr')`, extract `<button>` values.

---

## Configuration

### Brand Setup

**File:** `tests/lost-sales-check.spec.ts` (lines 320-325)

```typescript
const csvFiles: { [key: string]: string } = {
  'uat-bocop': 'uat_account_style_color_list.csv',
  'industry-of-all-nations': 'ioan_non_shirts_with_lost_sales.csv',
  'twillory-test': 'twillory_with_lost_sales.csv'
};
```

**To add new brand:**
1. Generate CSV (see `CSV_GENERATION.md`)
2. Add entry to `csvFiles` mapping
3. Run with `BRAND_KEY=your-brand`

---

### CSV Format

```csv
BRAND_KEY,DEPARTMENT,CATEGORY,CLASS,STYLE,COLOR,CHANNEL,REGION_NAME
twillory-test,Mens,Tops,Shirts,Leader Solid,White,ecommerce,global
```

**Required columns:**
- `DEPARTMENT`, `CATEGORY`, `CLASS`, `STYLE`, `COLOR` - Product hierarchy
- `CHANNEL`, `REGION_NAME` - Filter context
- `BRAND_KEY` - Must match the key used in test

---

## Skip Logic

Tests skip when:

**1. No lost sales section exists**
- Check: `text=Lost sales if you don't order` not found
- Reason: Product has no supply metrics calculated
- Log: "Skipping {style} / {color} - No lost sales section"

**Why not check "No lead time data"?**
- That text can appear in Actions column even when lost sales exists
- Only "Lost sales if you don't order" presence is reliable signal

---

## Environment Variables

### `USE_REAL_BRAND`
- Default: `false`
- Set to `true` to use real brand data instead of UAT
- Example: `USE_REAL_BRAND=true npx playwright test`

### `BRAND_KEY`
- Default: `public-rec` (if USE_REAL_BRAND), else `uat-bocop`
- Override with specific brand key
- Example: `BRAND_KEY=twillory-test npx playwright test`

### `TEST_LIMIT`
- Default: All products
- Limit number of products to test
- Example: `TEST_LIMIT=10 npx playwright test`

### `NAV_TEST_COUNT`
- Default: `1`
- Number of products to test with full UI navigation (slower but validates nav)
- Set to `all` to test all products with navigation
- Example: `NAV_TEST_COUNT=5 npx playwright test`

---

## Adding New Metrics

The test framework can be extended to validate other metrics beyond lost sales.

**Pattern:**
1. Identify metric on Monitoring page (row label)
2. Identify corresponding metric on Planning page (row label)
3. Copy `extractMonitoringLostSales()` and update selectors
4. Copy `extractPlanningLostSales()` and update row label
5. Use same `compareValues()` logic

**Examples:**
- Needed Inventory: Monitoring card vs Planning row
- Gross Sales: Monitoring summary vs Planning "Gross Sales" row
- Receipts: Monitoring "Firmed Receipts" vs Planning "Firmed Receipts"

---

## Test Suites

### Lost Sales - Planning vs. Monitoring (Direct URLs)

**Default test suite** - uses direct URLs for speed.

**Characteristics:**
- Fast (no UI navigation overhead)
- Parallelizable (5 workers by default)
- Tests all products from CSV
- ~6 seconds per product

---

### Lost Sales - Planning vs. Monitoring (Full Navigation)

**Optional suite** - validates UI navigation works.

**Characteristics:**
- Slower (clicks through Products → Mens → Tops → Shirts → Style → Color)
- Sequential only (navigation conflicts with parallel workers)
- Default: 1 product (configurable with NAV_TEST_COUNT)
- ~20 seconds per product

**Note:** This suite was tested but not currently enabled. The navigation loses context when clicking sidebar links. Direct URLs are more reliable.

---

## Debugging Failed Tests

### Mismatch Found

**Example output:**
```
[Compare] Indigo 12: 3 MISMATCHES

MISMATCHES for Band Collar Madras Shirt - LS - Lightweight / Indigo 12:
  JUL: Monitoring=21, Planning=4
  AUG: Monitoring=34, Planning=8
  SEP: Monitoring=18, Planning=4
```

**Investigation steps:**
1. Open Monitoring URL (logged in test output)
2. Open Planning URL (logged in test output)
3. Manually verify which value is correct
4. Report to engineering if real data issue

---

### Extraction Returns Empty

**Example output:**
```
Error: Indigo 12: Monitoring should show 3 months
Expected: 3
Received: 0
```

**Possible causes:**
1. **Color not found on page** - Check if color actually exists for that style
2. **UI structure changed** - Run diagnostic test: `npx playwright test diagnostic.spec.ts`
3. **Page didn't load** - Check screenshot in test-results directory

---

### Element Not Found

**Example:**
```
TimeoutError: locator.click: Timeout 15000ms exceeded.
waiting for getByRole('button', { name: 'Expand colors' })
```

**Fix:**
- Check if colors are pre-expanded (no button needed)
- Code already handles this with optional expand logic

---

## File Structure

```
playwright-tests/
├── tests/
│   ├── global-setup.ts              # Auth verification
│   ├── lost-sales-check.spec.ts     # Main test ← 450 lines
│   └── diagnostic.spec.ts           # Debug tool
├── playwright/.auth/
│   └── user.json                    # Auth session (expires ~30 days)
├── uat_account_style_color_list.csv # UAT test data (15 products)
├── ioan_non_shirts_with_lost_sales.csv  # Industry of All Nations (159 products)
├── ioan_shirts_with_lost_sales.csv      # IOAN Shirts only (11 products)
├── twillory_with_lost_sales.csv         # Twillory (232 products)
├── public_rec_with_lost_sales.csv       # Public Rec (247 products, no lead time)
├── playwright.config.ts             # Playwright configuration
├── package.json                     # Dependencies
├── RUN_TESTS.md                     # This file
├── LOST_SALES_TEST_GUIDE.md         # Technical reference
└── CSV_GENERATION.md                # Snowflake queries
```

---

## Known Limitations

### Products Without Lead Time

**Symptom:** All products for a brand skip with "No lost sales section"

**Cause:** Brand doesn't have production/shipping lead time configured in system

**Example:** public-rec (247 products have `lost_sales > 0` in Snowflake, but UI shows "No lead time data")

**Fix:** Configure lead time in application settings, not a test issue

---

### Navigation Test Limitations

Full navigation test (Products → Filters → Style) currently disabled because:
- Sidebar links lose filter context when navigating between pages
- Direct URLs more reliable
- Can re-enable with `NAV_TEST_COUNT` env var if navigation is fixed

---

## Performance

### Sequential (1 worker)
- 15 products: ~1.5 min
- 161 products: ~16 min
- 232 products: ~25 min

### Parallel (5 workers)
- 15 products: ~30 sec
- 161 products: ~3 min
- 232 products: ~5 min

**Note:** Current config uses 1 worker due to `fullyParallel: false` in playwright.config.ts. Change to `workers: 5` for faster execution.

---

## Validation Results

### UAT (uat-bocop)
- Products: 15 (3 styles × 5 colors)
- Passed: 16/16 (includes auth setup)
- Time: ~2 min
- Department: Mens / Tops / Shirts only

### Industry of All Nations
- Products: 170 (Shirts + Non-Shirts)
- Passed: 161/161
- Skipped: 9 (no lost sales section)
- Time: ~16 min (sequential)
- Coverage: All departments/categories

### Twillory
- Products: 232
- Passed: 216/216
- Skipped: 17 (no lost sales section)
- Time: ~25 min (sequential)
- Coverage: All departments/categories

**Total validated: 393 products across 3 brands (100% success rate)**

---

## Common Issues & Solutions

### Issue: "CSV file not found"

**Cause:** Brand CSV doesn't exist

**Fix:**
1. Generate CSV using queries in `CSV_GENERATION.md`
2. Add brand to `csvFiles` mapping in test
3. Re-run

---

### Issue: All tests skip

**Cause:** Brand uses different text for lost sales section

**Fix:**
1. Navigate to brand's Monitoring page manually
2. Find the exact text label for lost sales
3. Update line 394: `text=Lost sales if you don't order` → new text
4. Or make it flexible: `page.locator('text=/lost sales/i')`

---

### Issue: Extraction returns wrong values

**Symptom:** Test extracts style-level values instead of color-level

**Cause:** Using wrong parent selector (e.g., `closest('[class*="grid"]')` instead of `closest('tr')`)

**Fix:**
- Always use `closest('tr')` for table row isolation
- See lines 146-149 in `extractMonitoringLostSales()`

---

### Issue: Planning extraction returns duplicates

**Cause:** Both `<td>` and `<button>` contain values

**Fix:**
- Only extract from `<button>` elements (line 85)
- Skip `<td>` to avoid duplicates

---

## Extending to Other Brands

### Step 1: Generate CSV

See `CSV_GENERATION.md` for Snowflake query.

### Step 2: Add to Config

Edit `tests/lost-sales-check.spec.ts`:

```typescript
const csvFiles: { [key: string]: string } = {
  'uat-bocop': 'uat_account_style_color_list.csv',
  'your-brand-key': 'your_brand_with_lost_sales.csv'  // Add this
};
```

### Step 3: Test

```bash
USE_REAL_BRAND=true BRAND_KEY=your-brand-key TEST_LIMIT=5 npx playwright test lost-sales-check.spec.ts
```

Validate first 5 products pass, then run all.

---

## Diagnostic Tools

### diagnostic.spec.ts

**Purpose:** Inspect page structure when extraction fails

**Usage:**
```bash
npx playwright test diagnostic.spec.ts
```

**Outputs:**
- Month elements found (tag, text, nextSibling)
- H4 structure
- Color links found
- Lost sales context
- Screenshots: `diagnostic-before-expand.png`, `diagnostic-after-expand.png`

**When to use:**
- Extraction returns empty arrays
- New brand has different UI structure
- Need to understand DOM hierarchy

---

## Test Maintenance

### When UI Changes

**Symptoms:**
- TimeoutError waiting for elements
- Extraction returns empty
- Tests that previously passed now fail

**Investigation:**
1. Run diagnostic test: `npx playwright test diagnostic.spec.ts`
2. Check screenshots in `test-results/`
3. Use trace viewer: `npx playwright show-trace [trace.zip]`
4. Update selectors in extraction functions

**Common selector changes:**
- Month headings: `<h4>` → `<span class="month">`
- Values: `h4.nextElementSibling` → different structure
- Row isolation: `closest('tr')` → `closest('div[role="row"]')`

---

### When New Metric Added

**Pattern to follow:**

1. **Create extraction function:**
```typescript
async function extractMonitoringMetric(page: Page, colorName: string): Promise<MetricData> {
  // Find color row
  const colorLink = page.locator(`a:has-text("${colorName}")`);
  const row = colorLink.locator('..');

  // Extract metric values
  const values = await row.locator('[data-metric="your-metric"]').allTextContents();

  return { values: values.map(v => parseInt(v.replace(/,/g, ''))) };
}
```

2. **Add test case:**
```typescript
test(`${style} / ${color} - Your Metric`, async ({ page }) => {
  const monitoringData = await extractMonitoringMetric(page, color);
  const planningData = await extractPlanningMetric(page);
  const result = compareValues(monitoringData, planningData, color);
  expect(result.mismatches).toHaveLength(0);
});
```

---

## Code Quality Notes

### Why `closest('tr')` Not `closest('div')`

**Wrong approach:**
```typescript
const container = colorLink.closest('[class*="grid"]');
// Finds parent DIV spanning ALL rows → extracts style-level values
```

**Correct approach:**
```typescript
const row = colorLink.closest('tr');
// Finds specific table row for that color
```

**Lesson:** HTML tables (`<table>`, `<tr>`, `<td>`) provide semantic row isolation. Grid/flex layouts don't.

---

### Why Batch Extraction as Fallback

**Primary:** `extractMonitoringLostSales(page, colorName)` - targeted extraction

**Fallback:** `extractAllMonitoringColors(page)` - batch extraction

**Reason:** If single color fails (edge case DOM structure), batch extraction still works because it doesn't rely on specific parent traversal.

---

### Why First Occurrence for Month Matching

**Scenario:** Monitoring shows "JUL", Planning has ["JAN", "FEB", ..., "JUL", ..., "JUL 2027"]

**Question:** Which JUL to compare?

**Answer:** **First occurrence** (line 298: `planningData.headers.indexOf(month)`)

**Why:** Monitoring shows current month + lead time (e.g., Jan 2026 + 6 months = Jul 2026). Planning time series starts at current month and goes forward 18 months. First JUL encountered is the correct one.

---

## Best Practices

### Running Tests

**Start small:**
```bash
TEST_LIMIT=5 npx playwright test
```

**Then scale:**
```bash
npx playwright test  # All products
```

### Investigating Failures

**Don't guess - use traces:**
```bash
npx playwright show-trace test-results/[failing-test]/trace.zip
```

Shows:
- Step-by-step execution
- Screenshots at each step
- Network requests
- Console logs
- DOM snapshots

### CI/CD Integration

**GitHub Actions example:**
```yaml
- name: Run Lost Sales Tests
  run: |
    bun run auth  # Needs Google OAuth headless mode
    USE_REAL_BRAND=true BRAND_KEY=twillory-test npx playwright test lost-sales-check.spec.ts
```

**Note:** Auth requires browser interaction, may need headless OAuth flow or pre-generated token.

---

## Future Enhancements

### 1. Multi-Brand Support

Run all brands in one command:

```typescript
const BRANDS = ['uat-bocop', 'industry-of-all-nations', 'twillory-test'];
for (const brand of BRANDS) {
  test.describe(`Brand: ${brand}`, () => {
    // Load CSV for this brand
    // Run tests
  });
}
```

### 2. Parallel Workers

Change `playwright.config.ts`:
```typescript
workers: 5  // Currently 1
```

Reduces 25 min → 5 min for 232 products.

### 3. Scheduled Runs

Weekly cron to catch data drift:
```bash
0 2 * * 1 cd /path && USE_REAL_BRAND=true npx playwright test
```

### 4. Slack/Email Notifications

Integrate with Playwright reporters:
```typescript
reporter: [
  ['html'],
  ['json', { outputFile: 'results.json' }],
  ['./custom-slack-reporter.ts']
]
```

---

## References

- Playwright Docs: https://playwright.dev/docs/intro
- Trace Viewer: https://playwright.dev/docs/trace-viewer
- Test Reporters: https://playwright.dev/docs/test-reporters
- CI Integration: https://playwright.dev/docs/ci
