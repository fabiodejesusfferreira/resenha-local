/**
 * withSigning.js
 *
 * Plugin de configuração Expo que injeta a assinatura de release no
 * android/app/build.gradle e no android/gradle.properties toda vez que
 * `expo prebuild` é executado.
 *
 * IMPORTANTE: Este plugin NÃO copia o keystore — essa responsabilidade
 * é do script scripts/copy-keystore.js, chamado após o prebuild via
 * npm run build:release. Isso evita que operações de filesystem
 * interfiram na geração do template Android pelo prebuild.
 *
 * Requer signing.config.json na raiz do projeto.
 * Para criá-lo: npm run setup:signing
 */

const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(__dirname, '..', 'signing.config.json');

function readSigningConfig() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(raw);
  for (const key of ['keystorePath', 'keyAlias', 'storePassword', 'keyPassword']) {
    if (!config[key]) throw new Error(`Campo ausente em signing.config.json: "${key}"`);
  }
  return config;
}

const withSigning = (config) => {
  // Se o arquivo de configuração não existir, ignora silenciosamente.
  // O build debug ainda funciona com o debug.keystore padrão.
  if (!fs.existsSync(CONFIG_FILE)) {
    console.warn('⚠️  withSigning: signing.config.json não encontrado — assinatura de release não configurada.');
    console.warn('   Execute npm run setup:signing para configurar.');
    return config;
  }

  const signing = readSigningConfig();

  // 1. Injeta variáveis de assinatura no android/gradle.properties
  config = withGradleProperties(config, (cfg) => {
    const props = [
      { type: 'property', key: 'RESENHA_STORE_FILE',     value: 'release.keystore' },
      { type: 'property', key: 'RESENHA_KEY_ALIAS',      value: signing.keyAlias },
      { type: 'property', key: 'RESENHA_STORE_PASSWORD', value: signing.storePassword },
      { type: 'property', key: 'RESENHA_KEY_PASSWORD',   value: signing.keyPassword },
    ];

    for (const prop of props) {
      const existing = cfg.modResults.find((p) => p.key === prop.key);
      if (existing) {
        existing.value = prop.value; // atualiza se já existir
      } else {
        cfg.modResults.push(prop);
      }
    }

    return cfg;
  });

  // 2. Injeta signingConfigs.release e aplica no buildType release
  config = withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // Só modifica se ainda não tiver sido configurado
    if (!gradle.includes('RESENHA_STORE_FILE')) {
      // Adiciona bloco release dentro de signingConfigs { ... }
      const releaseBlock = `
        release {
            storeFile file(RESENHA_STORE_FILE)
            storePassword RESENHA_STORE_PASSWORD
            keyAlias RESENHA_KEY_ALIAS
            keyPassword RESENHA_KEY_PASSWORD
        }`;

      gradle = gradle.replace(
        /signingConfigs\s*\{(\s*debug\s*\{)/,
        `signingConfigs {${releaseBlock}\n    $1`
      );

      // Substitui o signingConfig de debug pelo de release no buildType release
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
