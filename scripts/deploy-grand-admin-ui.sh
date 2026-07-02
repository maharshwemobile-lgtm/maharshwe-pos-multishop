#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/opt/maharshwe/maharshwe-pos}"
SUPER_ROOT="${SUPER_ROOT:-/var/www/super.maharshwe.shop}"
DIST_INDEX="$ROOT/dist/grand-admin/index.html"
DIST_LOGO="$ROOT/dist/mahar-pos-logo.svg"
DIST_GS_JS="$ROOT/dist/grand-admin-google-sheet-integration.js"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/var/backups/maharshwe-super-before-github-grand-admin-$STAMP"

cd "$ROOT"

echo "=== Verify build output ==="
test -f "$DIST_INDEX" || { echo "Missing $DIST_INDEX. Run: npm run build"; exit 1; }
test -f "$DIST_LOGO" || { echo "Missing $DIST_LOGO. Run: npm run build"; exit 1; }
test -f "$DIST_GS_JS" || { echo "Missing $DIST_GS_JS. Run: npm run build"; exit 1; }

echo "=== Backup current super UI ==="
mkdir -p "$BACKUP"
rsync -a "$SUPER_ROOT/" "$BACKUP/"
echo "Backup saved to: $BACKUP"

echo "=== Deploy Mahar POS Grand Admin UI ==="
cp "$DIST_INDEX" "$SUPER_ROOT/index.html"
cp "$DIST_LOGO" "$SUPER_ROOT/mahar-pos-logo.svg"
cp "$DIST_GS_JS" "$SUPER_ROOT/grand-admin-google-sheet-integration.js"
python3 - "$SUPER_ROOT/index.html" "$STAMP" <<'PYINJECT'
import sys
from pathlib import Path
index = Path(sys.argv[1])
stamp = sys.argv[2]
html = index.read_text()
html = html.replace('<script src="/grand-admin-google-sheet-integration.js"></script>', '')
html = html.replace('</body>', f'<script src="/grand-admin-google-sheet-integration.js?v={stamp}"></script>\n</body>')
index.write_text(html)
PYINJECT
chown -R www-data:www-data "$SUPER_ROOT"

echo "=== Nginx reload ==="
nginx -t
systemctl reload nginx

echo "=== Live check ==="
curl -sk "https://super.maharshwe.shop/" | grep -o '<title>[^<]*</title>' || true
curl -sk "https://super.maharshwe.shop/" | grep -o 'Mahar POS · Grand Admin\|mahar-pos-logo.svg\|grand-admin-google-sheet-integration.js\|api/auth/login\|api/grand-admin/shops' | head -20 || true

echo "Done. Rollback: rsync -a --delete $BACKUP/ $SUPER_ROOT/ && nginx -t && systemctl reload nginx"
