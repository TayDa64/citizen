import { CAUSAL_RULES } from '../causalGraph';
import {
  influenceLabel,
  projectCausalHub,
} from '../causalInfluence';

/**
 * Campaign causal hub: nodes/edges from real CAUSAL_RULES with green/red influence.
 * Grammar only — not a Democracy 4 layout clone. Hub focus = company.burnRate.
 */
export default function CausalRulesPanel({ state } = {}) {
  const hub = projectCausalHub({
    taxRate: state?.taxRate,
    activeTriggers: state?.activeTriggers,
  }, CAUSAL_RULES);

  return (
    <section
      className="causal-rules-panel"
      aria-labelledby="causal-rules-heading"
      data-testid="causal-rules-panel"
    >
      <h3 id="causal-rules-heading">Causal hub (registry view)</h3>
      <p>
        Edges below are the executable <code>CAUSAL_RULES</code> registry — green = supportive,
        red = cost/pressure, signed = live direction. Hub focus:{' '}
        <code data-testid="causal-hub-focus">{hub.hubFocus}</code>. React Flow remains the system map.
      </p>

      <div className="causal-hub" data-testid="causal-hub">
        <ul className="causal-hub__nodes" aria-label="Causal nodes">
          {hub.nodes.map((node) => (
            <li
              key={node.id}
              className={node.hub ? 'causal-hub__node causal-hub__node--hub' : 'causal-hub__node'}
              data-testid={`causal-node-${node.id}`}
              data-hub={node.hub ? 'true' : 'false'}
            >
              {node.label}
              {node.hub ? <span className="causal-hub__hub-tag">hub</span> : null}
            </li>
          ))}
        </ul>

        <ul className="causal-hub__edges" aria-label="Causal influence edges">
          {hub.edges.map((edge) => (
            <li
              key={edge.id}
              className={`causal-hub__edge ${edge.className}`}
              data-testid={`causal-rule-${edge.id}`}
              data-polarity={edge.polarity}
              data-edge-id={edge.diagramEdgeId ?? undefined}
            >
              <div className="causal-hub__edge-line">
                <code className="causal-hub__rule-id">{edge.id}</code>
                <span className="causal-hub__arrow" aria-hidden="true">→</span>
                <code>{edge.sourcePath}</code>
                <span className="causal-hub__arrow" aria-hidden="true">→</span>
                <code>{edge.targetPath}</code>
                <span className={`causal-hub__polarity ${edge.className}`}>
                  {influenceLabel(edge.polarity)}
                </span>
              </div>
              <span className="causal-rules-panel__kind">{edge.kind}</span>
              {edge.explanation ? (
                <span className="causal-rules-panel__explain">{edge.explanation}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
