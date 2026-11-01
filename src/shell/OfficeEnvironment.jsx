import './tokens.css';

export default function OfficeEnvironment({ children }) {
  return (
    <div className="office-environment">
      <div className="office-environment__scene" aria-hidden="true">
        <svg className="office-environment__skyline" viewBox="0 0 1280 360" preserveAspectRatio="xMidYMax slice">
          <rect className="office-sky" width="1280" height="360" />
          <g className="office-buildings">
            <rect x="40" y="180" width="70" height="180" />
            <rect x="120" y="140" width="46" height="220" />
            <rect x="180" y="200" width="90" height="160" />
            <rect x="290" y="110" width="36" height="250" />
            <rect x="340" y="168" width="80" height="192" />
            <rect x="440" y="150" width="54" height="210" />
            <rect x="510" y="190" width="100" height="170" />
            <rect x="630" y="120" width="40" height="240" />
            <rect x="690" y="176" width="86" height="184" />
            <rect x="800" y="150" width="48" height="210" />
            <rect x="860" y="200" width="110" height="160" />
            <rect x="990" y="130" width="38" height="230" />
            <rect x="1040" y="186" width="92" height="174" />
            <rect x="1150" y="160" width="70" height="200" />
          </g>
          <rect className="office-wood" y="300" width="1280" height="60" />
          <circle className="office-lamp" cx="1040" cy="250" r="36" />
        </svg>
      </div>
      <div className="office-environment__stage">{children}</div>
    </div>
  );
}
