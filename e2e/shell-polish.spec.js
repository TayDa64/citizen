import { expect, test } from './fixtures';

const NARROW = { width: 390, height: 844 };
const PANEL_NAMES = ['Jurisdiction nest', 'Council calendar', 'Turn ledger', 'Ingest runs'];

async function showRoleGate(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('citizen.playerRole');
    } catch {
      // ignore quota / private-mode
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose your role' })).toBeVisible();
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('390px layout keeps role, tax, and Advance Month without sideways scroll', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await showRoleGate(page);
  await expect(page.getByTestId('role-company-ops')).toBeVisible();
  await expect(page.getByTestId('role-campaign')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByTestId('role-campaign').click();
  await expect(page.getByTestId('active-role-label')).toContainText('Campaign');
  const tax = page.getByRole('slider', { name: /tax rate/i });
  const advance = page.getByRole('button', { name: /advance month/i });
  await expect(tax).toHaveCount(1);
  await expect(tax).toBeVisible();
  await expect(advance).toBeVisible();
  for (const name of PANEL_NAMES) {
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name, exact: true })).toHaveCount(1);
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Ops desk', exact: true }).click();
  await expect(page.getByTestId('active-role-label')).toContainText('Company ops');
  await expect(page.getByTestId('campaign-desk')).toHaveCount(0);
  await expect(page.getByTestId('ops-tax-apply')).toHaveCount(1);
  await expect(page.locator('#civic-tax-rate')).toHaveCount(1);
  await expect(page.getByTestId('island-company-ops')).toBeVisible();
  await expect(page.getByTestId('island-campaign')).toBeVisible();
  await expect(page.locator('#civic-tax-rate')).toBeVisible();
  await expect(page.getByRole('button', { name: /advance month/i })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
