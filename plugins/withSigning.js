/**
 * withSigning.js
 *
 * Plugin de configuração Expo que injeta automaticamente a assinatura de release
 * no android/app/build.gradle e no android/gradle.properties toda vez que
 * `expo prebuild` (ou `npx expo prebuild --clean`) for executado.
 *
 * As credenciais são lidas do arquivo signing.config.json (nunca commitar esse arquivo).
 * O keystore fica em ~/resenha-local-release.keystore (fora do projeto).
 *
 * Para configurar pela primeira vez, veja: scripts/setup-keystore.sh
 */

const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(__dirname, '..', 'signing.config.json');
const KEYSTORE_DEST = path.join(__dirname, '..', 'android', 'app', 'release.keystore');

/**
 * Lê as credenciais de assinatura do arquivo de configuração local.
 * Se o arquivo não existir, lança um erro claro para o desenvolvedor.
 */
function readSigningConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      '\n\n❌ Arquivo signing.config.json não encontrado!\n' +
      'Execute primeiro: bash scripts/setup-keystore.sh\n' +
      'Ou crie manualmente o arquivo signing.config.json na raiz do projeto.\n' +
      'Veja scripts/setup-keystore.sh para o formato esperado.\n'
    );
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    const required = ['keystorePath', 'keyAlias', 'storePassword', 'keyPassword'];
    for (const key of required) {
      if (!config[key]) {
        throw new Error(`Campo obrigatório ausente no signing.config.json: "${key}"`);
      }
    }
    return config;
  } catch (e) {
    throw new Error(`\n\n❌ Erro ao ler signing.config.json:\n${e.message}\n`);
  }
}

/**
 * Copia o keystore para dentro do diretório android/app/.
 * Necessário porque o prebuild recria a pasta android/ do zero.
 */
function copyKeystoreIfNeeded(signing) {
  if (!fs.existsSync(signing.keystorePath)) {
    throw new Error(
      `\n\n❌ Keystore não encontrado em: ${signing.keystorePath}\n` +
      'Execute primeiro: bash scripts/setup-keystore.sh\n'
    );
  }

  const androidAppDir = path.join(__dirname, '..', 'android', 'app');
  if (!fs.existsSync(androidAppDir)) {
    fs.mkdirSync(androidAppDir, { recursive: true });
  }

  fs.copyFileSync(signing.keystorePath, KEYSTORE_DEST);
  console.log(`✅ Keystore copiado para: android/app/release.keystore`);
}

/**
 * Plugin principal — registrado no app.config.ts via `plugins`.
 */
const withSigning = (config) => {
  let signing;

  // Só aplica se o arquivo de configuração existir (ambiente de desenvolvimento do mantenedor).
  // Em ambientes sem signing.config.json, o plugin é ignorado silenciosamente.
  if (!fs.existsSync(CONFIG_FILE)) {
    console.warn('⚠️  signing.config.json não encontrado — assinatura de release não configurada.');
    return config;
  }

  signing = readSigningConfig();
  copyKeystoreIfNeeded(signing);

  // 1. Injeta as variáveis no android/gradle.properties
  config = withGradleProperties(config, (cfg) => {
    const props = [
      { type: 'property', key: 'RESENHA_STORE_FILE',     value: 'release.keystore' },
      { type: 'property', key: 'RESENHA_KEY_ALIAS',      value: signing.keyAlias },
      { type: 'property', key: 'RESENHA_STORE_PASSWORD', value: signing.storePassword },
      { type: 'property', key: 'RESENHA_KEY_PASSWORD',   value: signing.keyPassword },
    ];

    for (const prop of props) {
      const exists = cfg.modResults.find((p) => p.key === prop.key);
      if (!exists) {
        cfg.modResults.push(prop);
      } else {
        // Atualiza o valor se já existir (permite rodar o script novamente sem duplicar)
        exists.value = prop.value;
      }
    }

    return cfg;
  });

  // 2. Injeta o bloco signingConfigs e aplica no buildType release
  config = withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // Bloco signingConfigs.release — só adiciona se ainda não existir
    if (!gradle.includes('signingConfigs.release') && !gradle.includes('RESENHA_STORE_FILE')) {
      const releaseSigningBlock = `
    release {
            storeFile file(RESENHA_STORE_FILE)
            storePassword RESENHA_STORE_PASSWORD
            keyAlias RESENHA_KEY_ALIAS
            keyPassword RESENHA_KEY_PASSWORD
        }`;

      // Insere dentro do bloco signingConfigs existente (após a chave de abertura)
      gradle = gradle.replace(
        /signingConfigs\s*\{(\s*debug\s*\{)/,
        `signingConfigs {${releaseSigningBlock}\n    $1`
      );

      // Substitui signingConfig signingConfigs.debug no buildType release
      gradle = gradle.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        '$1signingConfig signingConfigs.release'
      );
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });

  return config;
};

module.exports = withSigning;
