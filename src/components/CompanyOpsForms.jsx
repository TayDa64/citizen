import { useState } from 'react';

const DEPARTMENTS = Object.freeze(['tech', 'marketing', 'sales']);

/**
 * Ops desk forms that drive real TurnCommands (set_tax, hire_employee).
 * Hire-only — no funding/exit/inventory/Gantt.
 */
export default function CompanyOpsForms({ taxRate, onSetTax, onHire }) {
  const [draftTax, setDraftTax] = useState(
    Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0.25,
  );
  const [department, setDepartment] = useState('tech');
  const [skill, setSkill] = useState(1);

  return (
    <section className="company-ops-forms" aria-labelledby="company-ops-forms-heading" data-testid="company-ops-forms">
      <h3 id="company-ops-forms-heading">Ops desk</h3>
      <p>Bind-only forms. Tax and hire commit through the turn engine — same backend as the campaign island.</p>

      <form
        className="company-ops-forms__tax"
        data-testid="ops-tax-form"
        onSubmit={(event) => {
          event.preventDefault();
          const next = Math.max(0, Math.min(1, Number(draftTax)));
          if (!Number.isFinite(next)) return;
          onSetTax?.(next);
        }}
      >
        <h4>Tax budget</h4>
        <label htmlFor="ops-tax-rate">
          Tax rate
          <input
            id="ops-tax-rate"
            data-testid="ops-tax-rate"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={draftTax}
            aria-valuetext={`${Math.round(draftTax * 100)}%`}
            onChange={(event) => setDraftTax(Number(event.target.value))}
          />
        </label>
        <p data-testid="ops-tax-readout">Tax: {Math.round(draftTax * 100)}%</p>
        <button type="submit" data-testid="ops-tax-apply">
          Apply tax (set_tax + advance)
        </button>
      </form>

      <form
        className="company-ops-forms__hire"
        data-testid="ops-hire-form"
        onSubmit={(event) => {
          event.preventDefault();
          onHire?.({ department, skill: Number(skill) || 1 });
        }}
      >
        <h4>Hire requisition</h4>
        <p>Node 3 Hire remains live; this desk form issues the same <code>hire_employee</code> command.</p>
        <label htmlFor="ops-hire-department">
          Department
          <select
            id="ops-hire-department"
            data-testid="ops-hire-department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            {DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="ops-hire-skill">
          Skill
          <input
            id="ops-hire-skill"
            data-testid="ops-hire-skill"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={skill}
            onChange={(event) => setSkill(event.target.value)}
          />
        </label>
        <button type="submit" data-testid="ops-hire-submit">
          Hire employee
        </button>
      </form>
    </section>
  );
}
