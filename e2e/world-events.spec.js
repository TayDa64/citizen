import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const POLICY = 'Policy change: talent cost +12%';

async function chartMarkup(page) {
  return page.locator('.metrics-chart').evaluate((root) => {
    const text = (selector) =>
      [...root.querySelectorAll(selector)].map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim());
    return {
      plotLines: root.querySelectorAll('.highcharts-plot-line').length,
      plotBands: root.querySelectorAll('.highcharts-plot-band').length,
      lineLabels: text('.highcharts-plot-line-label'),
      bandLabels: text('.highcharts-plot-band-label'),
      aria: [...root.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label') || ''),
      screenReader: text('.highcharts-screen-reader-region'),
    };
  });
}

function mentionsPolicy(state) {
  return [...state.lineLabels, ...state.bandLabels, ...state.aria, ...state.screenReader]
    .join('\n')
    .includes(POLICY);
}

test('applying, clearing, and toggling a world event removes the chart marker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cash & Burn Rate' })).toBeVisible();
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(0);

  const policy = page.getByRole('button', { name: /^Policy change / });
  await policy.click();
  await expect(page.locator('.metrics-chart .highcharts-plot-line-label')).toContainText(POLICY);
  let state = await chartMarkup(page);
  expect(state.plotLines, JSON.stringify(state)).toBeGreaterThan(0);
  expect(state.plotBands).toBeGreaterThan(0);
  expect(state.aria.some((label) => label.includes(`includes ${POLICY}`)), JSON.stringify(state.aria)).toBe(true);

  await page.getByRole('button', { name: 'Clear world events' }).click();
  await expect(page.locator('#world-events-heading')).toBeFocused();
  await expect(page.locator('#metrics-chart-description')).toContainText('No world event is active.');
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-line-label')).toHaveCount(0);
  state = await chartMarkup(page);
  expect(mentionsPolicy(state), JSON.stringify(state)).toBe(false);

  await page.getByRole('button', { name: /advance month/i }).click();
  await expect(page.getByText(/Burn\/mo: \$2200/)).toBeVisible();
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(0);
  state = await chartMarkup(page);
  expect(mentionsPolicy(state), JSON.stringify(state)).toBe(false);

  await policy.click();
  await expect(policy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(1);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(1);
  state = await chartMarkup(page);
  expect(state.aria.some((label) => label.includes(`includes ${POLICY}`)), JSON.stringify(state.aria)).toBe(true);

  await policy.click();
  await expect(policy).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#metrics-chart-description')).toContainText('No world event is active.');
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-line-label')).toHaveCount(0);
  state = await chartMarkup(page);
  expect(mentionsPolicy(state), JSON.stringify(state)).toBe(false);

  await page.getByRole('button', { name: /advance month/i }).click();
  await expect(page.locator('.metrics-chart .highcharts-plot-line')).toHaveCount(0);
  await expect(page.locator('.metrics-chart .highcharts-plot-band')).toHaveCount(0);
  state = await chartMarkup(page);
  expect(mentionsPolicy(state), JSON.stringify(state)).toBe(false);
});

test('event buttons expose a name that starts with the visible label', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'World events' })).toBeVisible();

  for (const label of ['Policy change', 'News spike', 'Market shift']) {
    const button = page.getByRole('button', { name: new RegExp(`^${label} `) });
    await expect(button).toBeVisible();
    await expect(button).not.toHaveAttribute('aria-label');
    const visibleLabel = (await button.locator('.trigger-button__title').innerText()).replace(/\s+/g, ' ').trim();
    expect(visibleLabel.startsWith(label)).toBe(true);
  }

  const idle = await new AxeBuilder({ page })
    .include('.trigger-panel')
    .withRules(['label-content-name-mismatch'])
    .analyze();
  expect(idle.violations).toEqual([]);

  await page.getByRole('button', { name: /^Policy change / }).click();
  const pressed = await new AxeBuilder({ page })
    .include('.trigger-panel')
    .withRules(['label-content-name-mismatch'])
    .analyze();
  expect(pressed.violations).toEqual([]);
});
