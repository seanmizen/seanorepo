#!/bin/bash
SESSION="debbie"

# Kill old session if it exists
tmux has-session -t $SESSION 2>/dev/null
if [ $? -eq 0 ]; then
  tmux kill-session -t $SESSION
fi

# Create session and window 1 for tsc --watch
tmux new-session -d -s $SESSION -n "build" "yarn tsc --watch"

# Create window 2 for running the CLI
tmux new-window -t $SESSION -n "app" "node dist/cli.js"

# Set status bar colors
tmux set-option -t $SESSION -g window-status-style "bg=yellow"
tmux set-option -t $SESSION -g window-status-current-style "bg=red,fg=white"

# Start on the 'app' window
tmux select-window -t $SESSION:app

# Attach to the session
tmux attach -t $SESSION
