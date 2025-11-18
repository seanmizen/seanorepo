#!/bin/bash

# Load environment variables and run the app
set -a
source .env
set +a

# Build and run
yarn tsc && node dist/cli.js
