import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import sodium from 'react-native-libsodium';
import RootNavigator from './src/navigation/RootNavigator';
import { initDatabase, purgeExpiredMessages } from './src/storage/database';
import { loadOrCreateDatabaseKey, loadOrCreateIdentityKeyPair, isBiometricReady } from './src/crypto/keys';
import { authenticateWithBiometrics } from './src/security/biometricAuth';
import { useProfileStore } from './src/state/profileStore';
import * as profileRepository from './src/storage/repositories/profileRepository';
import { getSecurityStatus, isOperationBlocked } from './src/security/rootPolicy';

type AppStatus = 'loading' | 'auth_needed' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const setProfile = useProfileStore((state) => state.setProfile);
  const setBiometricReady = useProfileStore((state) => state.setBiometricReady);

  useEffect(() => { initialize(); }, []);

  async function initialize() {
    setStatus('loading');
    try {
      await sodium.ready;

      // Verificação de root — filtrada para dev builds (ver rootPolicy.ts).
      // Política 'alert': a detecção corre silenciosamente; o aviso visível
      // fica disponível em Configurações para quem quiser consultar.
      // Apenas 'restricted' e 'locked' bloqueiam o app ativamente.
      const secStatus = await getSecurityStatus();
      if (secStatus.status === 'compromised' && isOperationBlocked('any')) {
        setErrorMessage('Ambiente comprometido detectado. O app não pode operar com segurança neste dispositivo.');
        setStatus('error');
        return;
      }

      // Banco não precisa de biometria — inicializa antes de qualquer tela.
      const dbKey = await loadOrCreateDatabaseKey();
      await initDatabase(dbKey);
      purgeExpiredMessages();

      const biometricConfigured = await isBiometricReady();
      setBiometricReady(biometricConfigured);

      if (biometricConfigured) {
        // Usuário voltando: pede biometria UMA vez com mensagem clara.
        const authenticated = await authenticateWithBiometrics(
          'Verifique sua identidade para acessar o Resenha Local'
        );

        if (!authenticated) {
          // Usuário cancelou — mostra tela de retry, não erro fatal.
          setStatus('auth_needed');
          return;
        }

        // Carrega as chaves (sem prompt — biometria já confirmada acima).
        await loadOrCreateIdentityKeyPair();

        const existingProfile = profileRepository.getProfile();
        if (existingProfile) setProfile(existingProfile);
      }
      // biometricConfigured = false: novos usuários vão para BiometricConsentScreen,
      // que faz sua própria autenticação e carrega as chaves lá.

      setStatus('ready');
    } catch (error: any) {
      console.warn('Erro na inicialização:', error);
      setErrorMessage('Não foi possível iniciar o app com segurança. Tente reinstalar.');
      setStatus('error');
    }
  }

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#1d9e75" />
        <Text style={styles.loadingText}>Carregando...</Text>
      </View>
    );
  }

  if (status === 'auth_needed') {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.authTitle}>Autenticação necessária</Text>
        <Text style={styles.authSubtitle}>
          Confirme sua identidade para acessar o Resenha Local.
        </Text>
        <Pressable style={styles.retryButton} onPress={initialize}>
          <Text style={styles.retryText}>Autenticar</Text>
        </Pressable>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#101314',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  loadingText: { color: '#666', marginTop: 12, fontSize: 14 },
  icon: { fontSize: 52, marginBottom: 16 },
  authTitle: {
    color: '#fff', fontSize: 20, fontWeight: '700',
    marginBottom: 8, textAlign: 'center',
  },
  authSubtitle: {
    color: '#a0a0a0', fontSize: 14, lineHeight: 20,
    textAlign: 'center', marginBottom: 28,
  },
  retryButton: {
    backgroundColor: '#1d9e75', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 32,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  errorText: { color: '#E24B4A', textAlign: 'center', fontSize: 15, lineHeight: 22 },
});
