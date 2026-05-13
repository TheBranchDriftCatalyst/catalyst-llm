/**
 * Public surface of the edges/ family. The orchestrator reads
 * EDGE_TYPES + the two color constants; geometry helpers are
 * private to this folder (FloatingEdge owns the only consumer).
 */
import { FloatingEdge } from "./FloatingEdge.js";

export const EDGE_TYPES = { floating: FloatingEdge };
export { EDGE_SOLID, EDGE_CONDITIONAL } from "./colors.js";
