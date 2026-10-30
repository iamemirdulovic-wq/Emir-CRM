/**
 * The design system: everything the CRM screens build on.
 *
 * The look is ported from the approved design at design/emir-crm-design.html.
 * Styles live in web/src/styles and are imported once, from main.tsx.
 */
export { AppShell } from './AppShell.js';
export type { AppShellProps, NavItem, ShellUser } from './AppShell.js';
export { Icon, ICON_NAMES } from './Icon.js';
export type { IconName, IconProps } from './Icon.js';
export { CountUp } from './CountUp.js';
export type { CountUpProps } from './CountUp.js';
export {
  applyAppearance,
  applyGlass,
  getAppearance,
  initTheme,
  isGlassReduced,
  resolveAppearance,
  setAppearance,
  setGlassReduced,
  useAppearance,
  useGlassReduced,
  usePrefersReducedMotion,
} from './theme.js';
export type { Appearance } from './theme.js';
export { AreaChart } from './charts/AreaChart.js';
export type { AreaChartProps, AreaPoint } from './charts/AreaChart.js';
export { ChartDefs } from './charts/ChartDefs.js';
export { Donut } from './charts/Donut.js';
export type { DonutProps, DonutSlice } from './charts/Donut.js';
export { Funnel } from './charts/Funnel.js';
export type { FunnelStep } from './charts/Funnel.js';
export { Gauge } from './charts/Gauge.js';
export type { GaugeProps } from './charts/Gauge.js';
export { Heat } from './charts/Heat.js';
export type { HeatProps } from './charts/Heat.js';
export { Spark } from './charts/Spark.js';
export type { SparkProps } from './charts/Spark.js';
export { smooth } from './charts/geometry.js';
export type { Point } from './charts/geometry.js';

/* The input family: everything an agent types into on a phone. */
export {
  Button, IconButton, PhoneInput, CurrencyInput, Combobox, WhenField, BudgetRange,
  budgetStepLabel, localInputValue, quickTimes,
} from './forms.js';
export type { ButtonProps, ComboOption, PhoneInputProps } from './forms.js';
export {
  COUNTRIES, DEFAULT_COUNTRY, countryOfE164, flagOf, readPhone,
} from './phone.js';
export type { Country, PhoneValue } from './phone.js';

/* Telling the agent what is happening. */
export {
  Badge, BottomSheet, ConfirmDialog, CountdownRing, Skeleton, SkeletonRows, StatCard, Tabs, TimelineItem,
} from './feedback.js';
export type { TabItem } from './feedback.js';
