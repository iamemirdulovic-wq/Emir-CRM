/**
 * Who counts as an agent.
 *
 * One rule, one place, because there were four. The owner opened four screens
 * on 13 Nov and was told the floor had 14, 11, 12 and 17 people on it:
 *
 *  - the dashboards counted `agent` + `manager`;
 *  - attendance counted everybody except the owner, so an **admin** sat in the
 *    register as though they were being measured on turning up;
 *  - Best of Homes and the team wall's ranking counted everybody except the
 *    service account, so the **owner and the admin were ranked as agents** —
 *    an owner who closes one deal outranks the floor;
 *  - "who has the CRM open" (`/api/activity/team`, the list under Team live)
 *    had no role filter at all, so the owner appeared among his own agents.
 *
 * The rule, settled by the owner: **an agent for counting purposes is role
 * `agent` or `manager`. Owner and admin are never counted as agents**, not in
 * attendance and not in Best of Homes. A manager carries leads and is on the
 * register, so a manager counts; an owner and an admin run the place.
 *
 * What this rule is NOT for, and the distinction matters:
 *
 *  - **who may own a lead** (`/api/add-lead/agents`) is deliberately wider —
 *    an owner of a ten-person brokerage sells, and a lead already parked on
 *    their name has to be reassignable;
 *  - **who should have a phone registered for alerts** (`pushReadiness`) is
 *    also wider, because managers, admins and the owner all receive the
 *    manager alerts, and a missing device there is a real gap.
 *
 * Both of those answer a different question and are left alone on purpose.
 */

/** The roles counted as agents, in the order a reader expects them. */
export const COUNTED_AGENT_ROLES = ['agent', 'manager'] as const;

export type CountedAgentRole = (typeof COUNTED_AGENT_ROLES)[number];

/** Is this role one of the people the floor's figures are about? */
export function isCountedAgent(role: string | null | undefined): boolean {
  return COUNTED_AGENT_ROLES.includes(String(role ?? '') as CountedAgentRole);
}

/**
 * The same rule as a SQL predicate: `u.role IN ('agent','manager')`.
 *
 * The role names are this module's own constants, never anything a request
 * carries, so they are written straight into the statement; the column name is
 * checked all the same, because a caller passing something clever into a
 * string that becomes SQL is exactly the mistake worth making impossible
 * rather than unlikely.
 */
export function countedAgentSql(column = 'u.role'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`countedAgentSql: "${column}" is not a column name`);
  }
  const roles = COUNTED_AGENT_ROLES.map((role) => `'${role}'`).join(',');
  return `${column} IN (${roles})`;
}
