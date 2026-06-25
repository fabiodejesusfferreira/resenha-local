import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Resenha Local',
  slug: 'resenha-local',
  scheme: 'resenhalocal',
  version: '0.2.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#101314',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#101314',
  },
  assetBundlePatterns: ['**/*'],
  android: {
    package: 'com.resenhalocal.app',
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#101314',
    },
    // allowBackup: false impede que o Android inclua o banco de dados e
    // o SecureStore em backups automáticos (Google Drive Backup, adb
    // backup, transferência entre aparelhos). O banco contém o histórico
    // de mensagens e o estado do ratchet — ambos sensíveis. As chaves de
    // identidade (SecureStore com WHEN_UNLOCKED_THIS_DEVICE_ONLY) já são
    // não-migráveis por definição do Android Keystore, mas o allowBackup
    // false reforça isso para o banco. Ver docs/threat-model.md, cenário
    // "roubo do banco local".
    allowBackup: false,
    blockedPermissions: ['android.permission.USE_FINGERPRINT'],
    permissions: [
      'BLUETOOTH_SCAN',
      'BLUETOOTH_ADVERTISE',
      'BLUETOOTH_CONNECT',
      'ACCESS_FINE_LOCATION',
      'NEARBY_WIFI_DEVICES',
      'ACCESS_WIFI_STATE',
      'CHANGE_WIFI_STATE',
      'ACCESS_NETWORK_STATE',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'POST_NOTIFICATIONS',
      'USE_BIOMETRIC',
    ],
  },
  plugins: [
    'expo-secure-store',
    // Plugin de assinatura de release — injeta keystore no build.gradle automaticamente.
    // Requer signing.config.json na raiz (ver scripts/setup-keystore.sh).
    './plugins/withSigning',
  ],
  extra: {
    eas: {
      projectId: 'COLOQUE_AQUI_O_SEU_PROJECT_ID',
    },
  },
});
