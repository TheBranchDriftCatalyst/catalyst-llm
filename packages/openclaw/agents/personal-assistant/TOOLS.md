# PersonalAssistant — Tool Access

## Authorized Tools
- **Beads**: `bd stats`, `bd blocked`, `bd list`, `bd show` (read-only)
- **File Read**: All workspace files
- **File Write**: `agents/personal-assistant/memory/` only
- **Memory Search**: Full workspace memory access

## Restricted
- No shell access
- No file writes outside designated memory directory
- No direct code execution
- No network access
