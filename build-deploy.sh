#!/usr/bin/env bash
set -euo pipefail

# 本地 OpenClaw 构建 + 部署脚本
# 源码: /Volumes/外置硬盘/OpenClaw/CodeSource
# 目标: /Volumes/外置硬盘/OpenClaw/app/node_modules/openclaw

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="/Volumes/外置硬盘/OpenClaw/app/node_modules/openclaw"

SKIP_BUILD=0
SKIP_UI=0
SKIP_DEPS=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-ui) SKIP_UI=1 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: bash build-deploy.sh [options]

Options:
  --skip-build   跳过后端构建
  --skip-ui      跳过前端 UI 构建
  --skip-deps    跳过目标目录依赖同步
  --dry-run      仅打印将要执行的关键步骤
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

C_GREEN='\033[0;32m'
C_CYAN='\033[0;36m'
C_RESET='\033[0m'

step() {
  echo -e "\n${C_CYAN}▶ $*${C_RESET}"
}

ok() {
  echo -e "${C_GREEN}✓ $*${C_RESET}"
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

if [[ ! -d "$DEST_DIR" ]]; then
  echo "目标目录不存在: $DEST_DIR" >&2
  exit 1
fi

cd "$SRC_DIR"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  step "构建后端"
  run "pnpm build"
  ok "后端构建完成"
else
  echo "[skip] 后端构建"
fi

if [[ "$SKIP_UI" -eq 0 ]]; then
  step "构建前端 Control UI (vite)"
  run "pnpm --dir ui build"
  ok "前端构建完成"
else
  echo "[skip] 前端构建"
fi

step "部署到 $DEST_DIR"
run "rsync -a dist/ '$DEST_DIR/dist/'"
ok "dist/ 已同步"
run "cp openclaw.mjs '$DEST_DIR/openclaw.mjs'"
ok "openclaw.mjs 已同步"
run "cp package.json '$DEST_DIR/package.json'"
ok "package.json 已同步"
run "rsync -a skills/ '$DEST_DIR/skills/'"
ok "skills/ 已同步"
run "rsync -a extensions/ '$DEST_DIR/extensions/'"
ok "extensions/ 已同步"
run "rsync -a docs/ '$DEST_DIR/docs/'"
ok "docs/ 已同步"
run "rsync -a assets/ '$DEST_DIR/assets/'"
ok "assets/ 已同步"

if [[ "$SKIP_DEPS" -eq 0 ]]; then
  step "同步运行依赖"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] (cd '$DEST_DIR' && pnpm install --prod --ignore-scripts)"
  else
    (
      cd "$DEST_DIR"
      pnpm install --prod --ignore-scripts
    )
  fi
  ok "依赖同步完成"
else
  echo "[skip] 依赖同步"
fi

ok "部署完成"

echo -e "\n${C_GREEN}════════════════════════════════════════════════${C_RESET}"
echo -e "${C_GREEN}  构建 + 部署完成！${C_RESET}"
echo -e "${C_GREEN}════════════════════════════════════════════════${C_RESET}"

echo -e "\n请重启 OpenClaw 使改动生效："
echo -e "  ${C_CYAN}/Volumes/外置硬盘/OpenClaw/openclaw.sh daemon restart${C_RESET}"
echo -e "  或手动 kill 后重新启动："
echo -e "  ${C_CYAN}pkill -f openclaw.mjs; /Volumes/外置硬盘/OpenClaw/openclaw.sh${C_RESET}"
