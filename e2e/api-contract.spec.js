import { expect, test } from './fixtures';

test('policy sample from the API shows $4,480 and the talent-cost burn', async ({ page }) => {
  test.skip(
    !process.env.CITIZEN_API_E2E,
    'Optional. Set CITIZEN_API_E2E=1 and VITE_CITIZEN_API=/api at build time, with the Citizen API listening on 127.0.0.1:8787. Playwright builds before preview. Not required for CI.'
  );

  await page.goto('/');
  await expect(page.getByRole('status', { name: /citizen service/i })).toBeVisible();
  const policy = page.getByRole('button', { name: /^Policy change / });
  await expect(policy).toContainText('$4,480');
  await expect(policy).toContainText('+12%');
  await policy.click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toContainText('$4,480');
  await expect(page.getByTestId('burn-value')).toContainText('$2,464');
  await expect(page.getByTestId('base-burn-value')).toContainText('$2,200');
  await expect(page.getByTestId('talent-multiplier-value')).toContainText('1.0000');
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.12');
  await expect(page.getByTestId('effective-multiplier-value')).toContainText('1.12');
  await expect(page.getByTestId('talent-equation')).toHaveAccessibleName(
    'Talent multiplier 1 times cost factor 1.12 equals 1.12'
  );
  await expect(page.getByTestId('rf__node-7')).toHaveAccessibleName(
    /Talent multiplier 1 times cost factor 1\.12 equals 1\.12/
  );
  await expect(page.locator('[data-id="3"]')).toContainText('Talent ×1.0000');
  await expect(page.locator('[data-id="7"]')).toContainText('Talent ×1.0000 × cost factor 1.12 = 1.12');
  await expect(page.locator('[data-id="7"]')).toContainText('Hype:');

  const priced = await page.request.get('http://127.0.0.1:8787/api/companies');
  expect(priced.ok()).toBeTruthy();
  const company = (await priced.json())[0];
  expect(company.talentMultiplier).toBe(1);
  expect(company.talentCostFactor).toBe(1.12);
  expect(company.effectiveMultiplier).toBe(1.12);
  expect(company.baseBurnRate).toBe(2000);
  expect(company.burnRate).toBe(2240);
  expect(company.cash).toBe(15000);

  const market = page.getByRole('button', { name: /^Market shift / });
  await market.click();
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.0304');
  await expect(page.getByTestId('burn-value')).toContainText('$2,267');
  const stacked = (await (await page.request.get('http://127.0.0.1:8787/api/companies')).json())[0];
  expect(stacked.talentCostFactor).toBe(1.0304);
  expect(stacked.effectiveMultiplier).toBe(1.0304);
  expect(stacked.baseBurnRate).toBe(2000);
  expect(stacked.burnRate).toBe(2061);
  expect(stacked.cash).toBe(15000);

  await page.getByRole('button', { name: 'Clear world events' }).click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toHaveCount(0);
  await expect(page.getByTestId('burn-value')).toContainText('$2,200');
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.00');
});
