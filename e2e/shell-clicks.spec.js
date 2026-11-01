import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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

async function hitOwner(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, 'control has a box').not.toBeNull();
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return {
      id: el.id || null,
      testid: el.getAttribute('data-testid'),
      frame: el.closest('.window-frame')?.getAttribute('data-testid') || null,
    };
  }, {
    x: box.x + box.width / 2,
    y: box.y + Math.min(box.height / 2, 16),
  });
}

test('role choices use their visible text as the accessible name', async ({ page }) => {
  await showRoleGate(page);

  const company = page.getByTestId('role-company-ops');
  const campaign = page.getByTestId('role-campaign');
  await expect(company).toHaveAccessibleName(/Company ops/);
  await expect(company).toHaveAccessibleName(/startup desk/i);
  await expect(campaign).toHaveAccessibleName(/Campaign/);
  await expect(campaign).toHaveAccessibleName(/world events/i);

  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test('company ops tax and hire stay clickable beside the diagram', async ({ page }) => {
  await showRoleGate(page);
  await page.getByTestId('role-company-ops').click();
  await expect(page.getByTestId('ops-tax-apply')).toBeVisible();

  const apply = await hitOwner(page, page.getByTestId('ops-tax-apply'));
  const hire = await hitOwner(page, page.getByTestId('ops-hire-submit'));
  const tax = await hitOwner(page, page.locator('#civic-tax-rate'));
  const diagramHire = await hitOwner(page, page.getByRole('button', { name: /hire tech employee/i }));

  expect(apply.frame).toBe('company-ops');
  expect(hire.frame).toBe('company-ops');
  expect(tax.id).toBe('civic-tax-rate');
  expect(diagramHire.frame).toBe('workflow-diagram');
});

test('raising Politics paints that window above the diagram', async ({ page }) => {
  await page.goto('/');
  const taxBefore = await hitOwner(page, page.locator('#civic-tax-rate'));
  expect(taxBefore.id).toBe('civic-tax-rate');

  await page.getByRole('button', { name: 'Politics', exact: true }).click();
  const title = page.getByTestId('campaign-politics').locator('.window-titlebar__title');
  const owner = await hitOwner(page, title);
  expect(owner.frame).toBe('campaign-politics');
});
