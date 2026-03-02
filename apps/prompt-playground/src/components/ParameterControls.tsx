import { Slider } from '@/catalyst-ui/ui/slider'
import { Label } from '@/catalyst-ui/ui/label'
import type { ChatParams } from '../lib/litellm'

interface ParameterControlsProps {
  params: ChatParams
  onChange: (params: Partial<ChatParams>) => void
}

export function ParameterControls({ params, onChange }: ParameterControlsProps) {
  return (
    <div className="space-y-5">
      <Label className="text-sm font-semibold">Parameters</Label>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Temperature</Label>
          <span className="text-muted-foreground tabular-nums">
            {(params.temperature ?? 0.7).toFixed(1)}
          </span>
        </div>
        <Slider
          value={[params.temperature ?? 0.7]}
          onValueChange={([temperature]) => onChange({ temperature })}
          min={0}
          max={2}
          step={0.1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Max Tokens</Label>
          <span className="text-muted-foreground tabular-nums">
            {params.max_tokens ?? 2048}
          </span>
        </div>
        <Slider
          value={[params.max_tokens ?? 2048]}
          onValueChange={([max_tokens]) => onChange({ max_tokens })}
          min={64}
          max={8192}
          step={64}
        />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <Label>Top P</Label>
          <span className="text-muted-foreground tabular-nums">
            {(params.top_p ?? 1.0).toFixed(2)}
          </span>
        </div>
        <Slider
          value={[params.top_p ?? 1.0]}
          onValueChange={([top_p]) => onChange({ top_p })}
          min={0}
          max={1}
          step={0.05}
        />
      </div>
    </div>
  )
}
