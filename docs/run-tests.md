# Run Tests - Command Sequence

Quick reference for running Lost Sales - Planning vs. Monitoring tests.

---

## Prerequisites

- Node.js or Bun installed
- Google account with staging access
- Snowflake access (optional, only for generating new brand CSVs)

---

## Installation

```bash
# Clone repository (first time only)
git clone https://github.com/FlagshipRTL/playwright-tests.git
cd playwright-tests

# Install dependencies
npm install
# or
bun install

# Install browser (one-time)
npx playwright install chromium
```

---

## Authentication

**One-time setup** (or when session expires):

```bash
bun run auth
```

Browser opens → Sign in with Google → Close browser when authenticated.

Auth session saved to `playwright/.auth/user.json` (valid for ~30 days).

---

## Run Tests

### All Brands (Recommended)

**Run comprehensive validation across UAT + all production brands:**

```bash
bash run-all-brands.sh
```

**What this does:**
- Tests UAT (15 products)
- Tests Industry of All Nations (161 products)
- Tests Twillory (232 products)
- Exports results to `test_results.csv`

**Time:** ~10 minutes (with 5 parallel workers)

---

### Single Brand

**UAT (default):**
```bash
npx playwright test lost-sales-check.spec.ts
```

**Specific brand:**
```bash
BRAND_KEY=twillory-test npx playwright test lost-sales-check.spec.ts
```

---

### Single Test (Quick Validation)

```bash
# Test one product to verify setup works
npx playwright test --grep "Base / Black"
```

**Expected:** ✓ 1 passed (~6 seconds)

---

### Run All Tests for a Brand (Deprecated - use run-all-brands.sh instead)

**UAT Test Data (15 products):**
```bash
npx playwright test lost-sales-check.spec.ts
```

**Industry of All Nations (161 products):**
```bash
BRAND_KEY=industry-of-all-nations npx playwright test lost-sales-check.spec.ts
```

**Twillory (232 products):**
```bash
BRAND_KEY=twillory-test npx playwright test lost-sales-check.spec.ts
```

---

### Run with Limit (Quick Smoke Test)

```bash
# Test first 10 products only
BRAND_KEY=twillory-test TEST_LIMIT=10 npx playwright test lost-sales-check.spec.ts
```

---

### View Results

**Terminal output shows:**
- ✓ Passed tests
- ✘ Failed tests (with mismatch details)
- \- Skipped tests (no lost sales data)

**HTML Report:**
```bash
npx playwright show-report
```

Opens browser with detailed results, screenshots, and traces.

---

## Troubleshooting

### Auth Expired

**Symptom:** Tests fail with 404 or "Not found" page

**Fix:**
```bash
bun run auth
```

---

### Test Failures

**View detailed error:**
```bash
# HTML report shows screenshots and page state
npx playwright show-report
```

**View trace (step-by-step replay):**
```bash
# Get path from test output, then:
npx playwright show-trace test-results/[test-name]/trace.zip
```

---

### Debugging

**Run with visible browser:**
```bash
npx playwright test --headed --grep "Product Name"
```

**Run in debug mode (step through):**
```bash
npx playwright test --debug --grep "Product Name"
```

---

## Configuration Options

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAND_KEY` | `uat-bocop` | Brand to test |
| `TEST_LIMIT` | All products | Limit number of products to test |
| `NAV_TEST_COUNT` | `1` | Number of full navigation tests (vs direct URLs) |

**Example:**
```bash
BRAND_KEY=twillory-test TEST_LIMIT=50 npx playwright test lost-sales-check.spec.ts
```

---

## Success Criteria

**Test passes when:**
- Monitoring lost sales values (3 months) match Planning "Potential Lost Sales" row
- Extraction finds correct months and values on both pages

**Test skips when:**
- Product has no "Lost sales if you don't order" section (missing data)

**Test fails when:**
- Values mismatch (indicates backend sync issue)
- Extraction fails (indicates UI change or test bug)

---

## Common Commands

```bash
# List all tests
npx playwright test --list

# Run specific brand
BRAND_KEY=twillory-test npx playwright test lost-sales-check.spec.ts

# Run with 5 parallel workers (faster)
npx playwright test --workers=5 lost-sales-check.spec.ts

# Run single test in headed mode
npx playwright test --headed --grep "AIR Blazer / Black"

# View last test report
npx playwright show-report
```

---

## Next Steps

After tests pass:
1. Review HTML report for any skipped tests
2. Investigate any failures (check screenshots)
3. For adding new brands, see: `CSV_GENERATION.md`
4. For technical details, see: `LOST_SALES_TEST_GUIDE.md`
