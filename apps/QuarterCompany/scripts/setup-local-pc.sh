#!/usr/bin/env bash
# setup-local-pc.sh - prepare one PC to run QuarterCompany with no network.
#
# Where: in WSL (Ubuntu, with systemd) on the PC. Run it from any folder of
#        the repo.
# When:  one time, while the PC is online. Run it again to change the model.
# Why:   REQ-QC-034. An offline run needs Ollama, the model and the Node
#        packages on the disk before the network goes off.
#
# The script installs Ollama, sets the server for one 6 GB GPU, pulls the
# model (about 3.3 GB), runs `yarn install`, and sends one test request with
# a tool. QC_LOCAL_MODEL changes the model. The default is the model of
# qwen-local in actors.yaml.
set -euo pipefail

MODEL="${QC_LOCAL_MODEL:-huihui_ai/qwen3.5-abliterated:4B}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

say() { printf '\n== %s\n' "$*"; }

say "1. Check the platform"
if [[ "$(uname -s)" != Linux ]]; then
  echo "Run this script in WSL or on Linux." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null || [[ "$(ps -p 1 -o comm=)" != systemd ]]; then
  echo "systemd is not running. Add these lines to /etc/wsl.conf:" >&2
  printf '  [boot]\n  systemd=true\n' >&2
  echo "Then run 'wsl --shutdown' in Windows, open WSL again, and run this script again." >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<20||(a===20&&b<19)) { console.error(`Node ${process.versions.node} is too old. Install Node 20.19 or later in WSL.`); process.exit(1) }'

say "2. Check the GPU"
if command -v nvidia-smi >/dev/null; then
  nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version --format=csv
  DRIVER="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1)"
  MAJOR="${DRIVER%%.*}"
  if ((MAJOR < 570)); then
    echo "WARNING: driver $DRIVER. Ollama needs driver 570 or later for compute capability 5.x. Update the Windows driver (580 branch)."
  elif ((MAJOR >= 590)); then
    echo "WARNING: driver $DRIVER. The 590 branch and later do not support Maxwell (GTX 900). Install a 580 branch driver in Windows."
  fi
else
  echo "WARNING: nvidia-smi is not in WSL. Ollama will use the CPU only. Install the Windows NVIDIA driver (580 branch), then run 'wsl --shutdown'."
fi

say "3. Install Ollama"
if command -v ollama >/dev/null; then
  ollama --version
else
  curl -fsSL https://ollama.com/install.sh | sh
fi

say "4. Set the Ollama server for one GPU"
# OLLAMA_HOST: listen on loopback only (REQ-QC-030).
# OLLAMA_CONTEXT_LENGTH: 8192 tokens. The default can be 4096, and Ollama
#   then cuts the start of a long briefing with no error.
# OLLAMA_NUM_PARALLEL=1 and OLLAMA_MAX_LOADED_MODELS=1: one copy of one
#   model, one request at a time (REQ-QC-033).
# OLLAMA_KEEP_ALIVE=-1: keep the model in memory between turns.
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/quarter-company.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
EOF
sudo systemctl daemon-reload
sudo systemctl enable ollama >/dev/null
sudo systemctl restart ollama
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:11434/api/version
echo

say "5. Pull $MODEL"
ollama pull "$MODEL"

say "6. Install the Node packages"
(cd "$ROOT" && yarn install)

say "7. Send one test request with a tool"
REPLY="$(curl -fsS http://127.0.0.1:11434/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "'"$MODEL"'",
    "reasoning_effort": "none",
    "messages": [{"role": "user", "content": "Call the whoami tool."}],
    "tools": [{"type": "function", "function": {"name": "whoami",
      "description": "Show your user name.",
      "parameters": {"type": "object", "properties": {}}}}]
  }')"
if grep -q '"tool_calls"' <<<"$REPLY"; then
  echo "OK: the model made a native tool call."
else
  echo "WARNING: the reply has no native tool call. QuarterCompany reads <tool_call> text as a fallback. Reply:"
  echo "$REPLY"
fi
ollama ps

say "Done"
echo "The PROCESSOR column of 'ollama ps' shows the GPU share, for example '15%/85% CPU/GPU'."
echo "Next: the README section 'Run offline on one PC'."
