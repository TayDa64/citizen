import { expect, test } from './fixtures';

function relativeLuminance(r, g, b) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color) {
  const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

test('tax slider maps to Slice 1 burn baselines 2000 / 2200 / 2800', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('burn-value')).toContainText('Burn/mo: $2,200');

  const tax = page.getByRole('slider', { name: /tax rate/i });
  await tax.fill('0');
  await expect(page.getByTestId('burn-value')).toContainText('Burn/mo: $2,000');
  await expect(page.getByTestId('base-burn-value')).toContainText('Base burn: $2,000');

  await tax.fill('0.25');
  await expect(page.getByTestId('burn-value')).toContainText('Burn/mo: $2,200');
  await expect(page.getByTestId('base-burn-value')).toContainText('Base burn: $2,200');

  await tax.fill('1');
  await expect(page.getByTestId('burn-value')).toContainText('Burn/mo: $2,800');
  await expect(page.getByTestId('base-burn-value')).toContainText('Base burn: $2,800');
});

test('Advance Month grows cash history on the metrics chart', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cash & Burn Rate' })).toBeVisible();

  const cashBefore = (await page.getByTestId('cash-value').innerText()).replace(/\s+/g, ' ').trim();
  const pointsBefore = await page.locator('.metrics-chart .highcharts-xaxis-labels text').count();

  await page.getByRole('button', { name: /advance month/i }).click();

  await expect(page.getByTestId('cash-value')).not.toHaveText(cashBefore);
  const pointsAfter = await page.locator('.metrics-chart .highcharts-xaxis-labels text').count();
  expect(pointsAfter).toBeGreaterThan(pointsBefore);
  expect(pointsAfter).toBeGreaterThanOrEqual(2);
});

test('civic band labels and edge labels are fully readable at default fitView', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-id="civic-tax"]')).toBeVisible();
  await expect(page.locator('#civic-tax-rate')).toBeEnabled();

  await expect(page.locator('[data-id="civic-tax"]')).toContainText('Tax Policy');
  await expect(page.locator('[data-id="civic-infra"]')).toContainText('Infrastructure');
  await expect(page.locator('[data-id="civic-reg"]')).toContainText('Regulations');
  await expect(page.locator('[data-id="7"]')).toContainText('Launch');

  const edgeLabels = await page.locator('.react-flow__edge-text').allTextContents();
  const joined = edgeLabels.map((t) => t.trim()).join(' | ');
  expect(joined, joined).toMatch(/burn rate/);
  expect(joined, joined).toMatch(/talent cost/);
  expect(joined, joined).toMatch(/compliance/);
  expect(joined, joined).not.toMatch(/complian\.\.\.|complian…|talent cos\.\.\./i);

  const coverage = await page.evaluate(() => {
    const bandIds = ['civic-tax', 'civic-infra', 'civic-reg', '7'];
    const nodes = bandIds.map((id) => {
      const el = document.querySelector(`[data-id="${id}"]`);
      const r = el.getBoundingClientRect();
      return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const overlaps = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const overlapX = !(a.right <= b.left || b.right <= a.left);
        const overlapY = !(a.bottom <= b.top || b.bottom <= a.top);
        if (overlapX && overlapY) overlaps.push(`${a.id}/${b.id}`);
      }
    }
    const civicLabels = ['burn rate', 'talent cost', 'compliance'];
    const covered = [...document.querySelectorAll('.react-flow__edge-text')]
      .map((el) => {
        const text = (el.textContent || '').trim();
        if (!civicLabels.includes(text)) return null;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = nodes.find(
          (n) => cx >= n.left && cx <= n.right && cy >= n.top && cy <= n.bottom
        );
        return hit ? `${text}@${hit.id}` : null;
      })
      .filter(Boolean);
    return { overlaps, covered };
  });
  expect(coverage.overlaps, JSON.stringify(coverage)).toEqual([]);
  expect(coverage.covered, JSON.stringify(coverage)).toEqual([]);
});

test('default React Flow nodes have readable contrast and Advance Month does not overlap data-source', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /advance month/i })).toBeVisible();
  await expect(page.locator('.data-source').first()).toBeVisible();

  const node = page.locator('.react-flow__node-default').first();
  await expect(node).toBeVisible();
  const styles = await node.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  expect(styles.text.length).toBeGreaterThan(0);
  const fg = parseRgb(styles.color);
  const bg = parseRgb(styles.backgroundColor);
  expect(fg, `unparsed foreground ${styles.color}`).not.toBeNull();
  expect(bg, `unparsed background ${styles.backgroundColor}`).not.toBeNull();
  const ratio = contrastRatio(
    relativeLuminance(fg.r, fg.g, fg.b),
    relativeLuminance(bg.r, bg.g, bg.b)
  );
  expect(ratio, JSON.stringify({ styles, ratio })).toBeGreaterThanOrEqual(4.5);

  const advanceBox = await page.getByRole('button', { name: /advance month/i }).boundingBox();
  const sourceBox = await page.locator('.data-source').first().boundingBox();
  expect(advanceBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(advanceBox.y + advanceBox.height).toBeLessThanOrEqual(sourceBox.y);
});
