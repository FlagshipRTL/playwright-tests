# CSV Generation - Snowflake Queries

How to generate style-color lists for new brands.

---

## Prerequisites

- Snowflake access configured (`snowsql -c snowflake`)
- Database: `visibility.prod`
- Tables: `precalculated_allocation_stats`, `product_hierarchy_reconstructed`, `brand`, `demand_region`, `demand_subregion`

---

## Standard Query

Use this query for any brand to get all style-color combinations with lost sales data:

```sql
select distinct
    b."key" as brand_key,
    p.division as department,
    p.category,
    p.class,
    p.style,
    p.color,
    dr.channel,
    dr.name as region_name
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p
    on a.sku_id = p.sku_id
left join visibility.prod.brand b
    on p.brand_id = b.id
left join visibility.prod.demand_subregion ds
    on a.fulfillment_center_id = ds.fulfillment_center_id
left join visibility.prod.demand_region dr
    on ds.parent_id = dr.id
where b."key" = 'YOUR-BRAND-KEY'      -- CHANGE THIS
  and a.date between '2026-05-01' and '2026-07-31'  -- Current + 2 months
  and a.lost_sales > 0                -- Only products with lost sales
  and p.style is not null
  and p.color is not null
  and dr.channel is not null
  and dr.name is not null
order by p.division, p.category, p.class, p.style, p.color;
```

---

## Run Query

```bash
snowsql -c snowflake -q "
[PASTE QUERY HERE]
" -o output_format=csv \
  -o header=true \
  -o timing=false \
  -o friendly=false > brand_name_with_lost_sales.csv
```

**Example for Twillory:**
```bash
snowsql -c snowflake -q "
select distinct
    b.\"key\" as brand_key,
    p.division as department,
    p.category,
    p.class,
    p.style,
    p.color,
    dr.channel,
    dr.name as region_name
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p on a.sku_id = p.sku_id
left join visibility.prod.brand b on p.brand_id = b.id
left join visibility.prod.demand_subregion ds on a.fulfillment_center_id = ds.fulfillment_center_id
left join visibility.prod.demand_region dr on ds.parent_id = dr.id
where b.\"key\" = 'twillory-test'
  and a.date between '2026-05-01' and '2026-07-31'
  and a.lost_sales > 0
  and p.style is not null
  and p.color is not null
  and dr.channel is not null
  and dr.name is not null
order by p.division, p.category, p.class, p.style, p.color;
" -o output_format=csv -o header=true -o timing=false -o friendly=false > twillory_with_lost_sales.csv
```

---

## Verify CSV

```bash
# Count products (subtract 1 for header)
wc -l brand_name_with_lost_sales.csv

# Preview first 10
head -10 brand_name_with_lost_sales.csv

# Check for required columns
head -1 brand_name_with_lost_sales.csv
# Should show: BRAND_KEY,DEPARTMENT,CATEGORY,CLASS,STYLE,COLOR,CHANNEL,REGION_NAME
```

---

## Filter by Product Category

### Example: Only Shirts

```sql
where b."key" = 'industry-of-all-nations'
  and p.division = 'Apparel'
  and p.category = 'Tops'
  and p.class = 'Shirts'
  and a.date between '2026-05-01' and '2026-07-31'
  and a.lost_sales > 0
  -- rest of filters...
```

### Example: Exclude Shirts

```sql
where b."key" = 'industry-of-all-nations'
  and NOT (p.division = 'Apparel' and p.class = 'Shirts')
  and a.date between '2026-05-01' and '2026-07-31'
  and a.lost_sales > 0
  -- rest of filters...
```

---

## Find Brands

### List all brands in system

```sql
select "key", name
from visibility.prod.brand
where is_active = true
order by name;
```

### Find brands with lost sales data

```sql
select distinct b."key", b.name, count(distinct p.sku_id) as sku_count
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p on a.sku_id = p.sku_id
left join visibility.prod.brand b on p.brand_id = b.id
where a.date >= '2026-01-01'
  and a.lost_sales > 0
group by b."key", b.name
order by sku_count desc;
```

---

## Date Range Guidelines

**Current month + lead time window:**

```sql
and a.date between '2026-05-01' and '2026-07-31'
```

**Why this range:**
- Current month: January 2026
- Typical lead time: 4-6 months
- Monitoring shows: May, June, July (current + lead time)
- Query May-Jul to ensure overlap

**Adjust if needed:**
- Longer lead times (12 months): extend end date to 2027-01-31
- Historical testing: use past date ranges

---

## CSV Column Requirements

### Required Columns

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `BRAND_KEY` | string | Brand identifier | `twillory-test` |
| `DEPARTMENT` | string | Product division | `Mens` |
| `CATEGORY` | string | Product category | `Tops` |
| `CLASS` | string | Product class | `Shirts` |
| `STYLE` | string | Product style | `Leader Solid` |
| `COLOR` | string | Product color | `White` |
| `CHANNEL` | string | Sales channel | `ecommerce` |
| `REGION_NAME` | string | Region name | `global` |

### Optional Columns (Ignored by Test)

- `SIZE`, `SKU` - Not needed for style-color level testing
- Date/metrics - Test navigates to pages, doesn't use CSV values

---

## Quality Checks

### After generating CSV

**1. Check for duplicates:**
```bash
# Should show 1 (header only)
sort brand_name_with_lost_sales.csv | uniq -d | wc -l
```

**2. Verify no missing values:**
```bash
# Look for empty fields (,,)
grep ",," brand_name_with_lost_sales.csv
```

**3. Check URL encoding:**
```bash
# Spaces should work (test handles encoding)
grep " " brand_name_with_lost_sales.csv | head -5
```

**4. Test sample:**
```bash
USE_REAL_BRAND=true BRAND_KEY=your-brand TEST_LIMIT=5 npx playwright test
```

---

## Historical Data

### Query past performance

```sql
-- Products with lost sales in December 2025
where b."key" = 'twillory-test'
  and a.date between '2025-12-01' and '2025-12-31'
  and a.lost_sales > 0
```

**Use case:** Regression testing against historical snapshots

---

## Filtering Strategies

### Only products with high lost sales

```sql
where b."key" = 'twillory-test'
  and a.lost_sales > 100  -- High impact products only
```

### Specific product categories

```sql
where b."key" = 'twillory-test'
  and p.category in ('Tops', 'Bottoms')
  and p.class in ('Shirts', 'Pants')
```

### Products in specific regions

```sql
where b."key" = 'twillory-test'
  and dr.name = 'north-america'  -- or 'europe', 'asia', etc.
  and dr.channel = 'wholesale'   -- or 'ecommerce'
```

---

## Example: Generate Subsets

### High-value products only

```bash
snowsql -c snowflake -q "
select distinct
    b.\"key\" as brand_key,
    p.division as department,
    p.category,
    p.class,
    p.style,
    p.color,
    dr.channel,
    dr.name as region_name,
    sum(a.lost_sales) as total_lost_sales
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p on a.sku_id = p.sku_id
left join visibility.prod.brand b on p.brand_id = b.id
left join visibility.prod.demand_subregion ds on a.fulfillment_center_id = ds.fulfillment_center_id
left join visibility.prod.demand_region dr on ds.parent_id = dr.id
where b.\"key\" = 'twillory-test'
  and a.date between '2026-05-01' and '2026-07-31'
  and a.lost_sales > 0
  and p.style is not null
  and p.color is not null
group by b.\"key\", p.division, p.category, p.class, p.style, p.color, dr.channel, dr.name
having sum(a.lost_sales) > 500  -- High impact only
order by total_lost_sales desc;
" -o output_format=csv -o header=true -o timing=false -o friendly=false > twillory_high_impact.csv
```

---

## Troubleshooting

### No results returned

**Check 1:** Brand key correct?
```sql
select "key", name from visibility.prod.brand where "key" like '%twill%';
```

**Check 2:** Date range has data?
```sql
select min(date), max(date)
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.brand b on a.brand_id = b.id
where b."key" = 'twillory-test';
```

**Check 3:** Lost sales calculated?
```sql
select count(*) as records_with_lost_sales
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.brand b on a.brand_id = b.id
where b."key" = 'twillory-test'
  and a.lost_sales > 0;
```

---

### CSV has wrong number of columns

**Cause:** Quote handling in Snowflake output

**Fix:** Use proper output format flags:
```bash
-o output_format=csv
-o header=true
-o timing=false
-o friendly=false
```

---

## Quick Reference

### Get product count before full query

```sql
select count(distinct p.division || '|' || p.category || '|' || p.class || '|' || p.style || '|' || p.color) as product_count
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p on a.sku_id = p.sku_id
left join visibility.prod.brand b on p.brand_id = b.id
where b."key" = 'YOUR-BRAND-KEY'
  and a.date >= '2026-05-01'
  and a.lost_sales > 0;
```

### Find styles with most colors

```sql
select
    p.style,
    count(distinct p.color) as color_count
from visibility.prod.precalculated_allocation_stats a
left join visibility.prod.product_hierarchy_reconstructed p on a.sku_id = p.sku_id
left join visibility.prod.brand b on p.brand_id = b.id
where b."key" = 'twillory-test'
  and a.date >= '2026-05-01'
  and a.lost_sales > 0
  and p.style is not null
group by p.style
order by color_count desc
limit 20;
```

---

## Saved Queries

Queries are saved in this directory:

- `get_brand_style_colors.sql` - Template query
- `test_dynamic_urls.sql` - Example with URL generation
- `create_view_style_color_dynamic.sql` - View definition

Edit `get_brand_style_colors.sql` and change `YOUR-BRAND-KEY` to target brand.
