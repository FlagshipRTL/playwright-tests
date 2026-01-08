#!/bin/bash

# Run Lost Sales tests across all brands and export to CSV
# Output: test_results.csv

echo "Running Lost Sales tests across all brands..."
echo ""

# Remove old results
rm -f test_results.csv

# Run UAT
echo "1/3 Testing UAT (uat-bocop)..."
npx playwright test lost-sales-check.spec.ts --grep "Direct URLs" 2>&1

# Run Industry of All Nations
echo "2/3 Testing Industry of All Nations..."
BRAND_KEY=industry-of-all-nations npx playwright test lost-sales-check.spec.ts --grep "Direct URLs" 2>&1

# Run Twillory
echo "3/3 Testing Twillory..."
BRAND_KEY=twillory-test npx playwright test lost-sales-check.spec.ts --grep "Direct URLs" 2>&1

echo ""
echo "✅ All brands tested"
echo "Results saved to: test_results.csv"

# Show summary
if [ -f test_results.csv ]; then
  echo ""
  echo "Total rows: $(wc -l < test_results.csv)"
  echo "Preview:"
  head -5 test_results.csv
fi
