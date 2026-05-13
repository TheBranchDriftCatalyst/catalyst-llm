/**
 * Floating-edge geometry + custom edge renderer for the topology
 * canvas. Edges anchor to the nearest point on each node's perimeter
 * instead of fixed handle positions — standard reactflow recipe (see
 * the official "floating edges" example). The result: edges always
 * exit / enter on the side facing the other node, never crossing a
 * node's body.
 */
import {
  Position,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

// Edge colors. The catalyst theme stores --accent / --foreground as
// full color values (#hex or hsl(...)), NOT as bare HSL triples — so
// `hsl(var(--accent))` would expand to e.g. `hsl(#some-hex)` which
// is invalid CSS and reactflow drops the stroke entirely (edges go
// invisible). We use the bare custom-property reference instead;
// browsers resolve it to whatever the active theme defines.
export const EDGE_SOLID = "var(--foreground)";
export const EDGE_CONDITIONAL = "var(--accent)";

/**
 * Returns the point on `intersectionNode`'s rectangle perimeter that
 * lies on the line drawn from intersectionNode's centre to
 * targetNode's centre. Pure geometry — the ellipse approximation
 * trick reactflow's example uses, which is exact for axis-aligned
 * rectangles.
 */
export function getNodeIntersection(
  intersectionNode: InternalNode,
  targetNode: InternalNode,
): { x: number; y: number } {
  const iw = intersectionNode.measured?.width ?? 0;
  const ih = intersectionNode.measured?.height ?? 0;
  const ipos = intersectionNode.internals.positionAbsolute;
  const tpos = targetNode.internals.positionAbsolute;
  const tw = targetNode.measured?.width ?? 0;
  const th = targetNode.measured?.height ?? 0;

  const w = iw / 2;
  const h = ih / 2;
  const x2 = ipos.x + w;
  const y2 = ipos.y + h;
  const x1 = tpos.x + tw / 2;
  const y1 = tpos.y + th / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return {
    x: w * (xx3 + yy3) + x2,
    y: h * (yy3 - xx3) + y2,
  };
}

/** Which side of `node` does `intersectionPoint` lie on? */
export function getEdgePosition(
  node: InternalNode,
  intersectionPoint: { x: number; y: number },
): Position {
  const n = { ...node.internals.positionAbsolute, ...node };
  const nx = Math.round(n.x);
  const ny = Math.round(n.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  if (px <= nx + 1) return Position.Left;
  if (px >= nx + w - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + h - 1) return Position.Bottom;
  return Position.Top;
}

export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);
  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}

/** Custom edge that recomputes its anchor points on every render from
 * the source + target nodes' live positions. */
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

export const EDGE_TYPES = { floating: FloatingEdge };
