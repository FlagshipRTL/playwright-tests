# Extraction & Alignment Architecture

## Two-Pass Extraction Logic

### Supply Extraction (Single Pass)

**Source:** "Demand forecast" row on Supply Planning page

**Logic:**
1. Iterate through all tables → find row containing "Demand forecast"
2. Extract values from each `<td>` cell
3. Check for `<input value="...">` elements (editable cells) before using innerText
4. Parse numbers, handle comma separators

**Output:** 18 values starting from current month

---

### Demand Extraction (Two-Pass)

**Source:** "Stats by Year" section on Forecasts page with multiple year rows

**Challenge:**
- Multiple Gross sales rows spanning 2-3 fiscal years
- Variable column counts (12, 13, or 14 per row)
- Variable boundary overlaps (0, 1, or 2 months)
- Must exclude historical rows (LY/LLY)

**Pass 1: Extract Individual Rows**

```typescript
const grossSalesRows = await page.evaluate(() => {
  const results: Array<{ year: number; values: number[] }> = [];
  const rows = document.querySelectorAll('tr');

  for (const row of rows) {
    const rowText = row.textContent || '';

    // Filter 1: Must be Gross sales
    if (!rowText.includes('Gross sales')) continue;

    // Filter 2: Exclude historical rows
    if (rowText.includes('(LY)') || rowText.includes('(LLY)')) continue;

    // Filter 3: Must have year range [YYYY-YYYY]
    const yearMatch = rowText.match(/Gross sales[^[]*\[(\d{4})[-–](\d{4})\]/);
    if (!yearMatch) continue;

    const yearStart = parseInt(yearMatch[1]);
    const cells = row.querySelectorAll('td');
    const values: number[] = [];

    for (let c = 0; c < cells.length; c++) {
      const cellText = cells[c].textContent?.trim() || '';
      if (cellText.includes('Gross sales')) continue; // Skip label cell

      // Check for input elements
      const input = cells[c].querySelector('input');
      const valueText = (input && input.value) ? input.value : cellText;

      const num = parseInt(valueText.replace(/,/g, ''));
      if (!isNaN(num) && num >= 0 && num < 10000000) {
        // Filter out year numbers but keep small values like 230
        if (num < 1900 || num > 2100 || num < 1000) {
          values.push(num);
        }
      }
    }

    if (values.length > 0) {
      results.push({ year: yearStart, values });
    }
  }

  return results;
});

// Sort chronologically
grossSalesRows.sort((a, b) => a.year - b.year);
```

**Pass 2: Concatenate with Dynamic Overlap Detection**

```typescript
let allValues: number[] = [];
let allLabels: string[] = [];

for (let i = 0; i < grossSalesRows.length; i++) {
  const row = grossSalesRows[i];
  const rowLabels = generateLabels(row.values.length);  // [OCT, NOV, DEC, ...]

  if (i === 0) {
    // First row: take all
    allValues = row.values;
    allLabels = rowLabels;
  } else {
    // Subsequent rows: calculate overlap dynamically
    let overlap = 0;

    for (let k = 1; k <= Math.min(3, rowLabels.length, allLabels.length); k++) {
      const prevEnd = allLabels.slice(-k);      // Last k labels of previous row
      const currStart = rowLabels.slice(0, k);  // First k labels of current row

      if (prevEnd.every((month, idx) => month === currStart[idx])) {
        overlap = k;  // Found overlap of k months
      }
    }

    // Append with overlap removed
    allValues = allValues.concat(row.values.slice(overlap));
    allLabels = allLabels.concat(rowLabels.slice(overlap));
  }
}

return { labels: allLabels, values: allValues };
```

**Example (1-month overlap):**
```
Row 1 ends:   [..., AUG, SEP, OCT]     values: [..., 215, 237]
Row 2 starts: [OCT, NOV, DEC, ...]     values: [237, 389, 307, ...]

Compare last 1 vs first 1:
prevEnd = [OCT]
currStart = [OCT]
Match → overlap = 1

Concatenate:
allValues = [..., 215, 237].concat([389, 307, ...])  // Skip 237 (duplicate)
          = [..., 215, 237, 389, 307, ...]            // 25 total values
```

**Why dynamic detection matters:**

| Product | Columns | Overlap | Boundary |
|---------|---------|---------|----------|
| Base / Black | 13 | 1 month | SEP/OCT |
| Base / White | 12 | 0 months | SEP → OCT (no overlap) |
| Backload / Black | 14 | 2 months | SEP/OCT/NOV |

Hardcoding `.slice(1)` breaks Base/White (removes valid data) and Backload/Black (leaves duplicate).

---

## Alignment Logic

**Problem:** Supply starts at DEC, Demand starts at OCT. Need to align at DEC for comparison.

**Why label-based (not value-based):**

Value-based matching fails on duplicates:
```
Supply: [564, 472, 278, 564, ...]  // Two 564 values!
Demand: [230, 463, 1124, 564, ...]

indexOf(564) = index 3
But which 564 is correct? Ambiguous.
```

Label-based is unambiguous:
```
Demand labels: [OCT, NOV, DEC, JAN, ...]
Find "DEC" → index 2 (unique)
Slice from index 2 → guaranteed correct alignment
```

**Steps:**
1. Find current month (DEC) in demand labels → get index
2. Slice demand from that index forward
3. Compare supply[i] vs demandSliced[i] for min(supply.length, demand.length) months
4. Return mismatches array and count

---

## Historical Row Filtering

**The Problem:** Stats by Year shows 4 Gross sales rows:

```
Gross sales [2026–2027]         ← Want (forecast)
Gross sales [2025–2026]         ← Want (forecast)
Gross sales (LY) [2024–2025]    ← Skip (historical actual)
Gross sales (LLY) [2023–2024]   ← Skip (historical actual)
```

**Why we can't hardcode years:**
```typescript
// ❌ BAD: Breaks in 2026
if (yearStart >= 2025) { ... }
```

**Pattern-based solution:**
```typescript
// ✅ GOOD: UI convention-based
if (rowText.includes('(LY)') || rowText.includes('(LLY)')) continue;
```

**Why this works:**
- UI explicitly labels historical rows with "(LY)" or "(LLY)"
- No year arithmetic (avoids fiscal year edge cases)
- Self-documenting (mirrors user's mental model)
- Works indefinitely (no annual code updates)

**Filter chain:** (1) Must include "Gross sales", (2) Must NOT include "(LY)" or "(LLY)", (3) Must match year range pattern `[YYYY-YYYY]`

---

## Key Design Principles

### 1. No Hardcoded Values

**Avoided:**
- ❌ Year numbers (2025, 2026)
- ❌ Column counts (12, 13, 14)
- ❌ Overlap amounts (0, 1, 2)

**Detected dynamically:**
- ✅ Year from regex: `\[(\d{4})[-–](\d{4})\]`
- ✅ Columns from `cells.length`
- ✅ Overlap from label comparison

### 2. Label-Based Alignment

```typescript
// Month labels are unique in 18-month window
const startIdx = demandLabels.indexOf("DEC");  // Unambiguous
```

vs value-based (fails on duplicates)

### 3. Pattern-Based Filtering

```typescript
// UI convention (robust to year changes)
if (rowText.includes('(LY)')) continue;
```

vs date arithmetic (fragile to fiscal year misalignment)

### 4. Separation of Concerns

- **Pass 1:** DOM extraction (row-by-row)
- **Pass 2:** Data processing (overlap detection)
- **Alignment:** Pure comparison logic

Each pass is independently testable.

---

## Current Status: 14/15 passing, 2 failing (Frontload/Brown, Backload/Dark Green) - only 2 values extracted instead of 25+. "Show year 2" checkbox not triggering year 2 data load.

---

## Additional Nuances

- **Overlap check:** Iterates k=1 to 3 (observed: 0-2, allows margin)
- **Month cycle:** Starts OCT (fiscal year), update array if changed
- **Value filters:** Excludes year numbers (2025, 2026) but keeps small forecasts (230, 463)
- **Lock classification:** Locked must match (fail test), unlocked may differ (log only)
