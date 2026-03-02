#!/bin/bash
# Backup Open WebUI data (chat history, settings)
# Models are not backed up (can be re-downloaded)
#
# Usage: ./scripts/backup.sh [output-dir]

set -e

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/open-webui-backup-$TIMESTAMP.tar.gz"

echo "🗄️  Catalyst LLM - Backup"
echo "========================="

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if data exists
if [ ! -d "./data/open-webui" ]; then
    echo "❌ No Open WebUI data found at ./data/open-webui"
    exit 1
fi

# Create backup
echo "📦 Creating backup..."
tar -czf "$BACKUP_FILE" -C ./data open-webui

# Show result
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup created: $BACKUP_FILE ($SIZE)"
echo ""

# List recent backups
echo "📋 Recent backups:"
ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -5

echo ""
echo "To restore: tar -xzf $BACKUP_FILE -C ./data"
