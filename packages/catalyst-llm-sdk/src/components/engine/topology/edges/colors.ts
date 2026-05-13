/**
 * Edge stroke colors — shared by FloatingEdge (renderer) and the
 * orchestrator's edges useMemo (per-edge style + marker color).
 *
 * The catalyst theme stores --accent / --foreground as full color
 * values (#hex or hsl(...)), NOT as bare HSL triples. That means
 * `hsl(var(--accent))` would expand to e.g. `hsl(#some-hex)` which
 * is invalid CSS and reactflow drops the stroke entirely (edges go
 * invisible). We use the bare custom-property reference instead;
 * browsers resolve it to whatever the active theme defines.
 */
export const EDGE_SOLID = "var(--foreground)";
export const EDGE_CONDITIONAL = "var(--accent)";
