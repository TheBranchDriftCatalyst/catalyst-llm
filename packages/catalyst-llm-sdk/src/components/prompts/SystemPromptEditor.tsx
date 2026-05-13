import { Textarea } from "@thebranchdriftcatalyst/catalyst-ui/ui/textarea";
import { Label } from "@thebranchdriftcatalyst/catalyst-ui/ui/label";

export interface SystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SystemPromptEditor({
  value,
  onChange,
}: SystemPromptEditorProps) {
  return (
    <div className="space-y-2">
      <Label>System Prompt</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter system prompt..."
        rows={4}
        className="resize-none"
      />
    </div>
  );
}
