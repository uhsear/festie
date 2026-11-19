#!/bin/bash
# Copyright (c) 2026 Asir Khan. All rights reserved.
# All Rights Reserved. See the LICENSE file.

# Cron Job Installation for Festie
# Prints crontab entries for health monitoring and error tracking
# Usage: bash scripts/setup-crons.sh

set -e

echo "📋 Festie Cron Job Setup"
echo "══════════════════════════════════════════════════════════════════"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Verify cron scripts exist
if [ ! -f "$script_dir/scripts/error-rate-alert.cjs" ]; then
  echo "❌ Error: scripts/error-rate-alert.cjs not found"
  echo "   Please create this script to track error rates"
  exit 1
fi

echo ""
echo "Recommended Crontab Entries:"
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "# Health check every 5 minutes (alerts via webhook, auto-restarts after 3 fails)"
echo "*/5 * * * * cd $script_dir && bash scripts/health-check.sh >> logs/cron-health.log 2>&1"
echo ""
echo "# Error rate alert every 5 minutes (check for sudden error spikes)"
echo "*/5 * * * * cd $script_dir && node scripts/error-rate-alert.cjs >> logs/cron-errors.log 2>&1"
echo ""
echo "# Backup and maintenance entries: see scripts/backup-cron.example"
echo "# Deploys are manual and guarded. No cron job deploys."
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "Installation Steps:"
echo ""
echo "1. Open your crontab editor:"
echo "   crontab -e"
echo ""
echo "2. Add the cron entries above to your crontab"
echo ""
echo "3. Create logs directory if it doesn't exist:"
echo "   mkdir -p $script_dir/logs"
echo ""
echo "4. Verify installation:"
echo "   crontab -l  # should show your new entries"
echo ""
echo "5. Monitor cron logs:"
echo "   tail -f $script_dir/logs/cron-health.log"
echo "   tail -f $script_dir/logs/cron-errors.log"
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "🔍 Health Check (scripts/health-check.sh)"
echo "   Checks:"
echo "   • /api/health responsiveness"
echo "   • Webhook alert and PM2 restart after 3 consecutive failures"
echo ""
echo "⚠️  Error Rate Alert (scripts/error-rate-alert.cjs)"
echo "   Checks:"
echo "   • Error request rate (5xx, 4xx errors)"
echo "   • Error spike detection (>3x average)"
echo "   • Slow query detection"
echo "   • Triggers alerts to ops channel"
echo ""
echo "Notes:"
echo "  • All scripts use env variables: DATABASE_URL, REDIS_URL, SLACK_WEBHOOK"
echo "  • Create .env file with these variables for cron to work properly"
echo "  • Ensure cron user has permission to: restart PM2, read .env, write logs"
echo "  • Logs in logs/ directory rotate weekly (implement logrotate separately)"
echo ""
