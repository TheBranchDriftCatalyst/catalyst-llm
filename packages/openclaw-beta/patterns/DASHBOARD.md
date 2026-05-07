# Pattern: Dashboard

## Purpose
Standard pattern for building monitoring dashboards across the catalyst-devspace ecosystem.

## Structure
```
dashboard/
├── src/
│   ├── components/
│   │   ├── MetricCard.tsx
│   │   ├── StatusIndicator.tsx
│   │   └── TimeSeriesChart.tsx
│   ├── hooks/
│   │   ├── useMetrics.ts
│   │   └── usePolling.ts
│   └── views/
│       └── Dashboard.tsx
├── stories/
│   └── Dashboard.stories.tsx
└── tests/
    └── Dashboard.test.tsx
```

## Key Decisions
- Use D3.js for custom visualizations
- React Query for data fetching with polling
- Radix UI primitives for layout components
- Tailwind CSS for styling
- WebSocket for real-time updates (when available)

## Metrics Display
- Use consistent color coding: Green (healthy), Yellow (warning), Red (critical)
- Include sparklines for trend visualization
- Show both current value and 24h change
- Auto-refresh interval: 30 seconds (configurable)

## Status
Stub — to be fleshed out in Phase 4.
