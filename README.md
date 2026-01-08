# FlagshipAI Playwright Tests

Automated validation tests for Supply Planning and Demand Forecasting data consistency.

## Test Suites

### 1. Lost Sales - Planning vs. Monitoring ✅ NEW

Validates "Lost sales if you don't order" (Supply Monitoring) matches "Potential Lost Sales" (Supply Planning).

**Status:** ✅ 393/393 passing (100%) - 2026-01-07
- UAT: 16/16 ✓
- Industry of All Nations: 161/161 ✓
- Twillory: 216/216 ✓

**Quick start:** [docs/run-tests.md](docs/run-tests.md)
**Technical reference:** [docs/lost-sales-test-guide.md](docs/lost-sales-test-guide.md)
**Add new brands:** [docs/csv-generation.md](docs/csv-generation.md)

---

### 2. Demand Forecast = Gross Sales (Phase 1)

Validates "Demand forecast" (Supply Planning) = "Gross sales" (Forecasts).

**Status:** ✅ 15/15 tests passing (100%) - 2025-12-19

## Quick Start

```bash
cd /Users/alexjofe/Docs/draper-lead/flagship-uat/playwright-tests

# 1. Install
bun install
bunx playwright install chromium

# 2. Authenticate (one-time)
bun run auth
# Complete Google OAuth, close when done

# 3. Run tests
bunx playwright test
```

## Test Coverage

**15 style-color combinations across 3 styles:**
- Base: Black, White, Navy, Brown, Dark Green
- Backload: Black, White, Navy, Brown, Dark Green
- Frontload: Black, White, Navy, Brown, Dark Green

## Test Approach

**Navigation:** UI clicks (validates user flow)
1. Start: `staging.flagshipai.com/brand/uat-bocop/products?channel=ecommerce&region=global`
2. Click: Mens → Tops → Shirts → [Style] → [Color]
3. Click sidebar: **Supply Planning**
4. Extract "Demand forecast" row → 18 values + column headers
5. Click sidebar: **Forecasts** → FORECAST tab
6. Click "Show year 2" checkbox (Radix UI component)
7. Extract both "Gross sales [YYYY-YYYY]" rows → 24-26 values + column headers
8. Align at current month (DEC), compare 18 months

**Key Features:**
- Auth.js (Google OAuth) with storageState
- **Actual header reading** from tables (not generated assumptions)
- Radix UI checkbox detection (`data-state` attribute)
- Input field value extraction (editable table cells)
- Dynamic year row concatenation with overlap detection (0-2 months)
- Lock status detection via Lucide icon classes (page-wide search)
- Unlocked forecasts: differences logged as INVALID (not failures)

## Commands

```bash
bunx playwright test                         # Run all tests
bunx playwright test --grep "Base / Black"   # Run specific test
bunx playwright test --headed                # With visible browser
bunx playwright test --debug                 # Step through
bunx playwright show-report                  # View results
```

## Files

```
playwright-tests/
├── playwright.config.ts         # Config
├── tests/
│   ├── global-setup.ts          # Auth verification
│   └── demand-supply.spec.ts    # Main test (15 cases)
├── playwright/
│   └── .auth/user.json          # Auth session (gitignored)
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript
├── .gitignore                   # Excludes auth, reports
└── README.md                    # This file
```

## Technical Notes

**Radix UI Checkbox:** The "Show year 2" control is a `<button role="checkbox">` with `data-state="checked"|"unchecked"|"indeterminate"`, not a native `<input type="checkbox">`.

**Editable Tables:** Stats by Year table uses `<input>` elements for values. Extraction checks `input.value` first, falls back to `innerText`.

**Lock Detection:** Uses page-wide `.lucide-lock` and `.lucide-check` class selectors. Locked forecasts must match exactly; unlocked forecasts log differences as INVALID for analyst review.

**Header Reading:** Column headers are read directly from table DOM (matching month patterns like `JAN`, `FEB`, etc.) rather than generated. This ensures correct alignment regardless of table structure variations.

**Value Extraction:** No year filtering applied to cell values. All numeric values `>= 0` are extracted. Previous filtering that excluded values in 1900-2100 range caused bugs (e.g., 2,072 was incorrectly filtered).

**Overlap Detection:** Year rows may have 0, 1, or 2 months of overlap at boundaries. Detection compares actual header labels (not assumed OCT start) to determine correct overlap.

## Classification Logic

| Lock Status | Values Match | Result |
|-------------|--------------|--------|
| Locked | Yes | ✅ PASS |
| Locked | No | ❌ FAIL |
| Unlocked | Yes | ✅ PASS |
| Unlocked | No | ⚠️ INVALID (not testable) |

## Bugs Fixed (2025-12-19)

1. **Lock detection scope:** Changed from parent-scoped to page-wide search for Lucide icons
2. **Header generation:** Changed from `generateLabels()` to reading actual table headers
3. **Year filter bug:** Removed filter that incorrectly excluded values like 2,072
