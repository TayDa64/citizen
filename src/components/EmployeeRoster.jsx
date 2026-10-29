/**
 * HRIS-lite roster bound to campaign GameState.employees after hire_employee.
 * No morale/happiness columns (unused by turn engine — would be fake).
 */
export default function EmployeeRoster({ employees = [] }) {
  const rows = Array.isArray(employees) ? employees : [];

  return (
    <section className="employee-roster" aria-labelledby="employee-roster-heading" data-testid="employee-roster">
      <h3 id="employee-roster-heading">Employee roster</h3>
      <p>Headcount from real hire commands (campaign authority after hire).</p>
      {rows.length === 0 ? (
        <p data-testid="employee-roster-empty">No employees hired yet.</p>
      ) : (
        <table className="employee-roster__table">
          <caption>Hired staff</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Department</th>
              <th scope="col">Skill</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? `${row.department}-${index}`}>
                <td>{index + 1}</td>
                <td>{row.department ?? 'unassigned'}</td>
                <td>{formatSkill(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatSkill(row) {
  if (Number.isFinite(Number(row.skill))) return Number(row.skill).toFixed(2);
  const dept = row.department;
  if (dept === 'tech' && Number.isFinite(Number(row.skillTech))) {
    return Number(row.skillTech).toFixed(2);
  }
  if (dept === 'marketing' && Number.isFinite(Number(row.skillMarketing))) {
    return Number(row.skillMarketing).toFixed(2);
  }
  if (dept === 'sales' && Number.isFinite(Number(row.skillSales))) {
    return Number(row.skillSales).toFixed(2);
  }
  return '—';
}
