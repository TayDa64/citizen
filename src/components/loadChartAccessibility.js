/**
 * The accessibility module is loaded on demand so it stays out of the main
 * chunk. A static import of `@highcharts/react/modules/Accessibility` pulls
 * `highcharts/es-modules/masters/modules/accessibility.src.js` into the entry
 * graph. The dynamic import is the split point.
 */
export function loadChartAccessibility() {
  return import('@highcharts/react/modules/Accessibility');
}
