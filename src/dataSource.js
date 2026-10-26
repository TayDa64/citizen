/**
 * OPEN DECISION: whether a talent-cost world event multiplies monthly burn.
 *
 * Local sample mode keeps PR #1: burn is round(2000 * (1 + taxRate * 0.4) * talentCost),
 * and talentCost is a multiplier around 1.
 * API mode follows Citizen API 0.3.0 / 0.4.0: burn stays round(2000 * (1 + taxRate * 0.4)).
 * Talent cost from the API is dollars and does not enter the burn formula.
 *
 * This is the only function that answers that question.
 */
export function talentCostMultipliesBurn(dataSource) {
  switch (dataSource) {
    case 'local':
      return true;
    case 'api':
      return false;
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown data source: ${String(neverSource)}`);
    }
  }
}

export function talentCostShowsDollars(dataSource) {
  switch (dataSource) {
    case 'local':
      return false;
    case 'api':
      return true;
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown data source: ${String(neverSource)}`);
    }
  }
}
