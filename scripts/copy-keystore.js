/**
 * copy-keystore.js
 *
 * Copia o release.keystore para android/app/ DEPOIS que o expo prebuild
 * gerou toda a estrutura Android. Chamado pelo script build:release em
 * package.json, entre o prebuild e o ./gradlew assembleRelease.
 *
 * Uso direto: node scripts/copy-keystore.js
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'signing.config.json');
const DEST = path.join(__dirname, '..', 'android', 'app', 'release.keystore');

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\n❌ signing.config.json não encontrado.');
  console.error('   Execute primeiro: npm run setup:signing\n');
  process.exit(1);
}

const signing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

if (!fs.existsSync(signing.keystorePath)) {
  console.error(`\n❌ Keystore não encontrado em: ${signing.keystorePath}`);
  console.error('   Execute primeiro: npm run setup:signing\n');
  process.exit(1);
}

fs.copyFileSync(signing.keystorePath, DEST);
console.log(`✅ Keystore copiado → android/app/release.keystore`);
