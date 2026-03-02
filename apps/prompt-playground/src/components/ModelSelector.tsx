import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/catalyst-ui/ui/select'
import { Button } from '@/catalyst-ui/ui/button'
import { Label } from '@/catalyst-ui/ui/label'
import { Monitor, Server, Cloud, RefreshCw } from 'lucide-react'
import { useModels } from '../hooks/useModels'
import type { ModelWithRouting } from '../lib/litellm'
import { cn } from '../lib/utils'

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
}

function ModelGroup({
  label,
  icon: Icon,
  models,
  iconColor,
}: {
  label: string
  icon: React.ElementType
  models: ModelWithRouting[]
  iconColor: string
}) {
  if (models.length === 0) return null

  return (
    <SelectGroup>
      <SelectLabel className="flex items-center gap-2 text-xs font-semibold">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        {label}
      </SelectLabel>
      {models.map(model => (
        <SelectItem
          key={model.id}
          value={model.id}
          className="flex items-center justify-between"
        >
          <div className="flex flex-col">
            <span className="font-medium">{model.id}</span>
            {model.endpoint?.apiBase && (
              <span className="text-xs text-muted-foreground">
                {model.endpoint.apiBase.replace(/^https?:\/\//, '').split('/')[0]}
              </span>
            )}
          </div>
        </SelectItem>
      ))}
    </SelectGroup>
  )
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { grouped, loading, error, refresh } = useModels()

  const hasModels =
    grouped.mac.length > 0 ||
    grouped.cluster.length > 0 ||
    grouped.cloud.length > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Model</Label>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          title="Refresh models"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {error && (
        <div className="text-xs text-destructive p-2 bg-destructive/10 rounded-md border border-destructive/20">
          {error}
        </div>
      )}

      <Select value={value} onValueChange={onChange} disabled={loading || !hasModels}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? 'Loading models...' : 'Select a model'} />
        </SelectTrigger>
        <SelectContent className="max-h-[400px]">
          <ModelGroup
            label="Local (Mac)"
            icon={Monitor}
            iconColor="text-green-500"
            models={grouped.mac}
          />
          <ModelGroup
            label="Cluster"
            icon={Server}
            iconColor="text-blue-500"
            models={grouped.cluster}
          />
          <ModelGroup
            label="Cloud"
            icon={Cloud}
            iconColor="text-purple-500"
            models={grouped.cloud}
          />
        </SelectContent>
      </Select>
    </div>
  )
}
