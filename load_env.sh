#!/bin/bash

# Codespaces Secretから環境変数を読み込む
if [ -f /workspaces/.codespaces/shared/.env-secrets ]; then
    export OPENAI_API_KEY=$(grep OPENAI_API_KEY /workspaces/.codespaces/shared/.env-secrets | cut -d'=' -f2- | tr -d "'" | tr -d '"' | base64 -d)
    echo "✅ OPENAI_API_KEY loaded from Codespaces Secrets"
    echo "   Key: ${OPENAI_API_KEY:0:7}...${OPENAI_API_KEY: -4}"
else
    echo "⚠️  Codespaces secrets file not found"
fi
