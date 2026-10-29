import { CAUSAL_RULES } from '../causalGraph';

/**
 * Campaign-island stub: show CAUSAL_RULES as a readable registry view.
 * Not a Democracy 4 clone — grammar only (signed influence list).
 */
export default function CausalRulesPanel() {
  return (
    <section
      className="causal-rules-panel"
      aria-labelledby="causal-rules-heading"
      data-testid="causal-rules-panel"
    >
      <h3 id="causal-rules-heading">Causal rules (registry view)</h3>
      <p>
        Enter-campaign path: edges below are the executable registry — React Flow is a view of these rules, not a second sim.
      </p>
      <ul className="causal-rules-panel__list">
        {CAUSAL_RULES.map((rule) => (
          <li key={rule.id} data-testid={`causal-rule-${rule.id}`}>
            <code>{rule.id}</code>
            <span className="causal-rules-panel__kind">{rule.kind ?? 'rule'}</span>
            {rule.explanation ? <span className="causal-rules-panel__explain">{rule.explanation}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
