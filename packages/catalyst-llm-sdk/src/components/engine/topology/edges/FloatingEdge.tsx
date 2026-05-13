/**
 * Custom edge that recomputes its anchor points on every render from
 * the source + target nodes' live positions. Wraps `getEdgeParams`
 * (sibling geometry.ts) and feeds the result into reactflow's
 * `getBezierPath` to render the svg path.
 */
import {
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { getEdgeParams } from "./geometry.js";

export function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
  );
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });
  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={path}
      markerEnd={markerEnd}
      style={style}
      fill="none"
    />
  );
}
