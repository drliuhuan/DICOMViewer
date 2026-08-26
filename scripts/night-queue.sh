#!/bin/bash
# DICOMViewer 通宵施工监督进程（2026-08-26 00:5x 启动，跑至 08:00 CST）
# 队列串行: 每个任务书 = OpenCode(qwen3.8-27b) 施工 → 门禁(build+vitest) → commit+push → 下一个
# 状态文件在 /tmp/oc-night/: <task>.done | <task>.skip | <task>.result | supervisor.log
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:$PATH"
cd /home/drliuhuan/DICOMViewer || exit 1
mkdir -p /tmp/oc-night
LOG=/tmp/oc-night/supervisor.log
STOP_EPOCH="${STOP_EPOCH:-$(date -d '2026-08-26 18:00:00' +%s)}"

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

log "=== supervisor started pid=$$ stop=$(date -d @$STOP_EPOCH '+%F %T') ==="

while [ "$(date +%s)" -lt "$STOP_EPOCH" ]; do
  # 找最早未完成的任务书（有 .done 或 .skip 视为完成）
  TASK=""
  for f in docs/task-m2-fix1.md docs/task-m3.md docs/task-m4.md docs/task-m5.md docs/task-m6.md docs/task-m7.md docs/task-m8.md docs/task-m9.md; do
    base=$(basename "$f" .md)
    if [ -f "$f" ] && [ ! -f "/tmp/oc-night/$base.done" ] && [ ! -f "/tmp/oc-night/$base.skip" ]; then
      TASK="$f"; break
    fi
  done

  if [ -z "$TASK" ]; then
    log "IDLE: 无待执行任务书，60s 后重查"
    sleep 60
    continue
  fi

  NAME=$(basename "$TASK" .md)
  START_TS=$(date +%s)
  log ">>> START $NAME ($(wc -c < "$TASK") bytes)"

  # 施工: 最长 75 分钟
  timeout --signal=TERM --kill-after=30 4500 \
    opencode run "$(cat "$TASK")" --model local-gateway/qwen3.8-27b \
    > "/tmp/oc-night/$NAME.out" 2>&1
  RC=$?
  pkill -f "opencode run" 2>/dev/null && sleep 2

  # 预取下一个任务书（消除里程碑衔接空转；失败不阻塞）
  python3 /home/drliuhuan/.hermes/scripts/night_task_writer.py >>"$LOG" 2>&1 || true

  # 门禁: build(含tsc) 必须过；vitest 必须过；lint 仅告警；OpenCode 输出含 upstream/Endpoint 错误=施工失败
  GATE=OK; GM=""
  if grep -q "upstream error\|Endpoint is unavailable\|do request failed" "/tmp/oc-night/$NAME.out" 2>/dev/null; then
    GATE=FAIL; GM="opencode_upstream_error"
  fi
  if [ "$GATE" = "OK" ]; then
    npm run build >"/tmp/oc-night/$NAME.build.log" 2>&1 || { GATE=FAIL; GM="build"; }
  fi
  if [ "$GATE" = "OK" ]; then
    npx vitest run >"/tmp/oc-night/$NAME.test.log" 2>&1 || { GATE=FAIL; GM="tests"; }
  fi
  if [ "$GATE" = "OK" ]; then
    npx eslint src tests >"/tmp/oc-night/$NAME.lint.log" 2>&1 || GATE=WARN_LINT
  fi

  MIN=$(( ($(date +%s)-START_TS)/60 ))
  if [ "$GATE" != "FAIL" ]; then
    BR=$(git rev-parse --abbrev-ref HEAD)
    git add -A >/dev/null 2>&1
    git commit -q -m "night($NAME): via opencode qwen3.8-27b, gate=$GATE, ${MIN}min

$(tail -5 "/tmp/oc-night/$NAME.out" 2>/dev/null | head -c 400)" >/dev/null 2>&1
    if git push -q origin "$BR" >>"$LOG" 2>&1; then
      PUSH="pushed"
    else
      PUSH="PUSH_FAILED(local committed)"
      log "WARN: git push failed for $NAME"
    fi
    touch "/tmp/oc-night/$NAME.done"
    echo "gate=$GATE rc=$RC ${MIN}min $PUSH $(date '+%F %T')" > "/tmp/oc-night/$NAME.result"
    log "<<< DONE $NAME gate=$GATE rc=$RC ${MIN}min $PUSH"
  else
    { echo "== NIGHT QUEUE: FAILED gate=$GM rc=$RC after ${MIN}min =="; echo "--build tail--"; tail -30 "/tmp/oc-night/$NAME.build.log" 2>/dev/null; echo "--test tail--"; tail -30 "/tmp/oc-night/$NAME.test.log" 2>/dev/null; } >> "/tmp/oc-night/$NAME.out"
    touch "/tmp/oc-night/$NAME.skip"
    echo "FAILED gate=$GM rc=$RC ${MIN}min $(date '+%F %T')" > "/tmp/oc-night/$NAME.result"
    log "XXX FAIL $NAME gate=$GM rc=$RC ${MIN}min -> skip & continue"
  fi
done
log "=== supervisor exit (time up) ==="
