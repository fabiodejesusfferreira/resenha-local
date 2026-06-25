#!/bin/bash
# =============================================================================
# setup-keystore.sh
#
# Script de configuração inicial de assinatura do Resenha Local.
# Execute UMA VEZ para criar o keystore e o arquivo signing.config.json.
#
# Uso:
#   bash scripts/setup-keystore.sh
#
# O keystore fica em ~/.resenha-local/ (fora do projeto, nunca vai para o Git).
# O signing.config.json fica na raiz do projeto mas está no .gitignore.
# =============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYSTORE_DIR="$HOME/.resenha-local"
KEYSTORE_PATH="$KEYSTORE_DIR/release.keystore"
CONFIG_FILE="$PROJECT_ROOT/signing.config.json"

echo ""
echo "🔑 Configuração de assinatura — Resenha Local"
echo "=============================================="
echo ""

# Garante que o diretório seguro existe
mkdir -p "$KEYSTORE_DIR"

# ---- Gerar keystore se ainda não existir ----
if [ -f "$KEYSTORE_PATH" ]; then
  echo "✅ Keystore já existe em: $KEYSTORE_PATH"
  echo "   Pulando geração (delete manualmente se quiser regenerar)."
else
  echo "📦 Gerando keystore em: $KEYSTORE_PATH"
  echo ""
  echo "Você será solicitado a definir senhas e informações do certificado."
  echo "IMPORTANTE: Guarde essas senhas em lugar seguro (ex: gerenciador de senhas)."
  echo ""

  keytool -genkey -v \
    -keystore "$KEYSTORE_PATH" \
    -alias resenha-local \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000

  echo ""
  echo "✅ Keystore gerado com sucesso!"
fi

# ---- Coletar senhas para o signing.config.json ----
echo ""
echo "📝 Agora vamos criar o arquivo signing.config.json"
echo "   (Ele fica na raiz do projeto mas está no .gitignore)"
echo ""

read -s -p "Digite a Store Password (que você definiu acima): " STORE_PASS
echo ""
read -s -p "Digite a Key Password (mesma ou diferente da store): " KEY_PASS
echo ""

# ---- Cria o arquivo de configuração ----
cat > "$CONFIG_FILE" << EOF
{
  "keystorePath": "$KEYSTORE_PATH",
  "keyAlias": "resenha-local",
  "storePassword": "$STORE_PASS",
  "keyPassword": "$KEY_PASS"
}
EOF

echo ""
echo "✅ signing.config.json criado em: $CONFIG_FILE"
echo ""
echo "=============================================="
echo "🎉 Configuração concluída!"
echo ""
echo "Próximos passos:"
echo "  1. npm run build:release   — faz prebuild + gera APK assinado"
echo "  2. npm run install:release — instala o APK no dispositivo via adb"
echo ""
echo "Para uma nova build após limpar a pasta android:"
echo "  npm run clear && npm run build:release"
echo ""
