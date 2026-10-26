import {
  clampedTalentCostFactor,
  equationNumber,
  expect,
  formatFactor,
  formatMoney,
  roundTo,
  simulationBurn,
  test,
} from './fixtures';

test('policy sample from the API shows $4,480 and the talent-cost burn', async ({ page }) => {
  test.skip(
    !process.env.CITIZEN_API_E2E,
    'Optional. Set CITIZEN_API_E2E=1 and VITE_CITIZEN_API=/api at build time, with the Citizen API listening on 127.0.0.1:8787. Playwright builds before preview. Not required for CI.'
  );

  await page.goto('/');
  await expect(page.getByRole('status', { name: /citizen service/i })).toBeVisible();
  const before = (await (await page.request.get('http://127.0.0.1:8787/api/companies')).json())[0];
  const policy = page.getByRole('button', { name: /^Policy change / });
  await expect(policy).toContainText('+12%');
  await policy.click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toBeVisible();
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.12');

  const priced = await page.request.get('http://127.0.0.1:8787/api/companies');
  expect(priced.ok()).toBeTruthy();
  const company = (await priced.json())[0];
  const policyView = viewOf(company);
  expect(company.talentCostFactor).toBe(1.12);
  expect(company.talentCostFactorClamped).toBe(false);
  expect(company.effectiveMultiplier).toBe(roundTo(company.talentMultiplier * company.talentCostFactor, 4));
  expect(company.burnRate).toBe(Math.round(company.baseBurnRate * company.talentMultiplier * company.talentCostFactor));
  expect(company.cash).toBe(before.cash);
  await expect(page.getByRole('region', { name: 'World event effect' })).toContainText(formatMoney(company.talentCost));
  expect(company.baseBurnRate).toBe(before.baseBurnRate);
  await expect(page.getByTestId('burn-value')).toContainText(policyView.burn);
  await expect(page.getByTestId('base-burn-value')).toContainText(policyView.base);
  await expect(page.getByTestId('talent-multiplier-value')).toContainText(policyView.multiplierText);
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText(policyView.factorText);
  await expect(page.getByTestId('talent-cost-factor-value')).toHaveAccessibleName(policyView.factorName);
  await expect(page.getByTestId('effective-multiplier-value')).toContainText(policyView.effectiveText);
  await expect(page.getByTestId('talent-equation')).toHaveAccessibleName(policyView.equation);
  await expect(page.getByTestId('rf__node-7')).toHaveAccessibleName(new RegExp(policyView.equation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page.locator('[data-id="3"]')).toContainText(`Talent ×${policyView.multiplierText}`);
  await expect(page.locator('[data-id="7"]')).toContainText(policyView.visible);
  await expect(page.locator('[data-id="7"]')).toContainText('Hype:');

  const market = page.getByRole('button', { name: /^Market shift / });
  await market.click();
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.0304');
  const stacked = (await (await page.request.get('http://127.0.0.1:8787/api/companies')).json())[0];
  const marketView = viewOf(stacked);
  expect(stacked.talentCostFactor).toBe(1.0304);
  expect(stacked.talentCostFactorClamped).toBe(false);
  expect(stacked.effectiveMultiplier).toBe(roundTo(stacked.talentMultiplier * stacked.talentCostFactor, 4));
  expect(stacked.burnRate).toBe(Math.round(stacked.baseBurnRate * stacked.talentMultiplier * stacked.talentCostFactor));
  expect(stacked.cash).toBe(before.cash);
  expect(stacked.baseBurnRate).toBe(before.baseBurnRate);
  await expect(page.getByTestId('burn-value')).toContainText(marketView.burn);

  await page.getByRole('button', { name: 'Clear world events' }).click();
  await expect(page.getByRole('region', { name: 'World event effect' })).toHaveCount(0);
  const cleared = (await (await page.request.get('http://127.0.0.1:8787/api/companies')).json())[0];
  expect(cleared.talentCostFactor).toBe(1);
  expect(cleared.talentCostFactorClamped).toBe(false);
  await expect(page.getByTestId('burn-value')).toContainText(formatMoney(simulationBurn(cleared)));
  await expect(page.getByTestId('talent-cost-factor-value')).toContainText('1.00');
});

function viewOf(company) {
  const employee = Number(company.talentMultiplier);
  const factor = clampedTalentCostFactor(company.talentCostFactor);
  const effective = roundTo(employee * factor, 4);
  const factorText = formatFactor(factor);
  return {
    burn: formatMoney(simulationBurn(company)),
    base: formatMoney(Math.round(2000 * 1.1)),
    multiplierText: employee.toFixed(4),
    factorText,
    factorName: `Talent cost factor ${factorText}`,
    effectiveText: formatFactor(effective),
    equation: `Talent multiplier ${equationNumber(employee)} times cost factor ${equationNumber(factor)} equals ${equationNumber(effective)}`,
    visible: `Talent ×${employee.toFixed(4)} × cost factor ${factorText} = ${formatFactor(effective)}`,
  };
}
