# Resenha Local

Bate-papo local por proximidade. Sem login, sem servidor, sem internet — as mensagens trafegam direto entre os celulares, cifradas de ponta a ponta com Bluetooth/Wi-Fi via **Nearby Connections API** do Google.

Este repositório é o esqueleto funcional do app descrito no documento de planejamento (`resenha-local-planejamento.md`, gerado anteriormente). Ele já traz a arquitetura completa — módulo nativo, criptografia, armazenamento, estado e telas — pronta para ser refinada, testada em aparelhos reais e publicada.

## Por que development build (e não Expo Go)

O app usa a Nearby Connections API do Google, que não tem suporte no Expo Go porque exige código nativo Android compilado junto ao binário. Por isso, o projeto inclui um **módulo nativo local** (`modules/nearby-transport`) e precisa rodar sempre via **development build** (`expo-dev-client` + EAS Build), nunca pelo app Expo Go da loja.

## Pré-requisitos

- Node.js LTS e npm
- Conta Expo/EAS (`npx eas login`)
- Android Studio com SDK/NDK instalados, **ou** usar o build na nuvem do EAS (recomendado se você não quer configurar o ambiente Android localmente)
- Dois aparelhos Android físicos para testar a comunicação por proximidade — **emulador não enxerga outro emulador via Bluetooth/Nearby**, então esse teste exige hardware real

## Primeiros passos

```bash
npm install

# Reconcilia as versões das dependências nativas com a versão do Expo SDK
# instalada (importante: os números de versão no package.json são um ponto
# de partida, não a palavra final — deixe o Expo resolver as versões certas).
npx expo install --check

# Gera o projeto nativo Android localmente (opcional, só se for buildar local)
npx expo prebuild

# Login e configuração do projeto no EAS
npx eas login
npx eas init
```

Depois, gere e instale um development build no celular:

```bash
npm run build:dev
# baixe o .apk gerado pelo EAS e instale no aparelho via adb install ou o QR code do próprio EAS

npm start
# abre o Metro bundler; o app instalado no aparelho conecta nele
```

Repita a instalação do development build em **dois aparelhos** para conseguir testar a descoberta e a troca de mensagens de verdade.

## Build local e assinatura do APK (sem EAS)

O projeto inclui um **plugin de configuração Expo** (`plugins/withSigning.js`) que injeta automaticamente a assinatura de release no `build.gradle` toda vez que a pasta `android/` é regenerada. Isso resolve o problema de perder a configuração ao rodar `npm run clear`.

### Configuração inicial (apenas uma vez)

Antes de gerar o primeiro APK assinado, crie o keystore e o arquivo de credenciais locais:

```bash
npm run setup:signing
```

O script vai:

1. Gerar o keystore em `~/.resenha-local/release.keystore` — **fora do projeto**, para não ser apagado com `npm run clear`.
2. Perguntar as senhas e criar o arquivo `signing.config.json` na raiz do projeto.

> ⚠️ **Guarde as senhas em um gerenciador de senhas.** Perder o keystore ou as senhas torna impossível atualizar o app na Play Store sob o mesmo pacote.

> 🔒 `signing.config.json` e `release.keystore` estão no `.gitignore` — nunca serão versionados.

### Gerar o APK assinado

```bash
# Faz prebuild + compila o APK de release (assinado)
npm run build:release

# O APK fica em:
# android/app/build/outputs/apk/release/app-release.apk
```

### Instalar no dispositivo via adb

```bash
# Instala o APK no aparelho conectado
npm run install:release

# Ou os dois passos de uma vez (build + install):
npm run release
```

### Limpar tudo e rebuildar do zero

Este é o fluxo que você já usa — agora com assinatura automática:

```bash
# Apaga android/ e .expo/, refaz o prebuild e gera o APK assinado
npm run rebuild
```

O plugin detecta o `signing.config.json`, copia o keystore para `android/app/release.keystore` e configura o `build.gradle` e o `gradle.properties` — tudo sem intervenção manual.

### Como o plugin funciona

```
signing.config.json   →   withSigning.js (plugin Expo)
        ↓
  expo prebuild
        ↓
  android/app/build.gradle  ← signingConfigs.release injetado
  android/gradle.properties ← RESENHA_STORE_* injetado
  android/app/release.keystore ← copiado de ~/.resenha-local/
        ↓
  ./gradlew assembleRelease
        ↓
  APK assinado ✅
```

---

## Estrutura do projeto

```
resenha-local/
├── App.tsx                      # inicialização: sodium, banco cifrado, navegação
├── app.config.ts                 # config Expo (permissões Android, ícones, EAS)
├── eas.json                      # perfis de build (development/preview/production)
│
├── modules/nearby-transport/     # módulo nativo: wrapper da Nearby Connections API
│   ├── index.ts                   # interface TypeScript exposta ao app
│   └── android/.../NearbyTransportModule.kt   # implementação Kotlin (Expo Modules API)
│
└── src/
    ├── crypto/                   # identidade, handshake (X25519), cifragem (XChaCha20-Poly1305)
    ├── storage/                  # SQLite cifrado + repositórios (perfil, contatos, mensagens, grupos)
    ├── state/                    # stores Zustand (perfil, dispositivos próximos, mensagens)
    ├── transport/                # orquestra módulo nativo + criptografia + armazenamento
    ├── navigation/                # React Navigation
    ├── screens/                   # Onboarding, Radar, Chat, Configurações
    └── utils/permissions.ts       # solicitação de permissões Android em runtime
```

## Como as peças se conectam

1. **Onboarding** gera a identidade criptográfica do aparelho (par de chaves X25519 via libsodium, guardado no Android Keystore) e salva o perfil local — nada disso sai do aparelho.
2. **Radar** pede as permissões necessárias e inicia `NearbyTransportService`, que por sua vez chama o módulo nativo para anunciar (`startAdvertising`) e descobrir (`startDiscovery`) outros aparelhos rodando o app.
3. Ao encontrar alguém, o app solicita conexão automaticamente. Assim que a conexão é aceita nos dois lados, os aparelhos trocam suas chaves públicas (handshake) e derivam uma chave de sessão compartilhada — **sem transmitir nenhum segredo pela rede**.
4. Toda mensagem digitada no **Chat** é cifrada com essa chave de sessão antes de ser enviada pelo módulo nativo, e persistida já cifrada no SQLite local.

O diagrama de arquitetura completo está no documento de planejamento gerado anteriormente.

## Segurança — o que já está implementado vs. o que é roadmap

Implementado neste scaffold:
- Identidade por dispositivo (X25519), sem conta nem verificação externa
- Handshake automático de chaves ao conectar com um novo contato
- Cifragem autenticada (XChaCha20-Poly1305 / AEAD) de toda mensagem
- Banco de dados local cifrado em repouso (SQLCipher via op-sqlite)
- Função de "impressão digital de segurança" (`crypto/fingerprint.ts`) pronta para uso, mas ainda **não exposta em nenhuma tela** — adicionar um botão "verificar contato" na tela de chat é o próximo passo natural de segurança

Deixado como roadmap (ver documento de planejamento, seção 3 e 10):
- Forward secrecy completo (double ratchet) — a versão atual usa uma chave de sessão estável por conversa
- Grupos com "sender keys" (hoje, grupo seria fan-out pareado simples)
- Rede mesh multi-salto para estender o alcance além da conexão direta
- Compartilhamento de mídia

## Limitações conhecidas deste scaffold

Este código foi escrito como referência de arquitetura completa e **não foi compilado/testado em dispositivo real** neste ambiente (sem acesso a build Android aqui). Antes de ir para produção:

- Rode `npx expo install --check` para alinhar as versões exatas das dependências nativas com a versão do Expo SDK que você instalar — os números no `package.json` são um ponto de partida.
- Compile o módulo nativo (`npx expo run:android` ou um build de development no EAS) e corrija eventuais ajustes de Gradle/Kotlin — é o tipo de coisa que só aparece ao compilar de verdade.
- Teste a permissão de Bluetooth em pelo menos um aparelho Android ≤ 11 e um ≥ 12, já que o fluxo de permissões muda bastante entre essas versões.
- Adicione os assets visuais em `assets/` (ver `assets/README.txt`) antes do primeiro build.
- Telas de "criar grupo" e "verificar contato" têm a lógica de base pronta (repositório de grupos, função de fingerprint) mas ainda não têm uma tela própria — só o fluxo 1:1 está com UI completa.

## Comandos úteis

### Build local (sem EAS)

```bash
npm run setup:signing    # configura keystore e signing.config.json (1x só)
npm run build:release    # prebuild + APK assinado de release
npm run install:release  # instala o APK no dispositivo via adb
npm run release          # build:release + install:release
npm run rebuild          # clear + build:release (apaga android/ e reconstrói)
npm run clear            # apaga android/ e .expo/ (limpa o cache)
npm run apk              # apenas ./gradlew assembleRelease (sem prebuild)
npm run stop             # para o daemon do Gradle
```

### Build na nuvem (EAS)

```bash
npm run build:dev        # build de development (instalável com expo-dev-client)
npm run build:preview    # build de preview/teste interno (apk)
npm run build:production # build de produção (app bundle, para a Play Store)
npm run submit:production # envia o build de produção para a faixa interna da Play Store
```

### Desenvolvimento

```bash
npm run typecheck        # checagem de tipos TypeScript
npm run lint             # lint com ESLint
```

## Problemas comuns

**App não encontra o outro aparelho.** Confirme que o Bluetooth e o Wi-Fi estão ligados nos dois aparelhos (a Nearby Connections usa os dois), que as permissões foram concedidas (veja em Ajustes do Android > Apps > Resenha Local > Permissões) e que nenhum dos dois está com economia de bateria agressiva ativada para o app.

**Conexão cai sozinha em segundo plano.** Verifique se o foreground service (`NearbyDiscoveryService`) está rodando — deve aparecer uma notificação persistente "Buscando pessoas por perto". Em alguns fabricantes (Xiaomi, Samsung), é preciso desativar manualmente a otimização de bateria para o app.

**Erro de build relacionado a `expo-modules-core` no Gradle do módulo.** Confirme que rodou `npx expo prebuild` (ou que o EAS Build está fazendo isso automaticamente) antes de tentar compilar — o `android/build.gradle` do módulo depende da estrutura gerada pelo prebuild.

## Próximos passos sugeridos

1. Compilar e testar o fluxo de descoberta + handshake em dois aparelhos reais.
2. Adicionar a tela de verificação de impressão digital de segurança (a lógica já existe em `crypto/fingerprint.ts`).
3. Implementar a tela de criação de grupos reaproveitando `groupsRepository.ts`.
4. Preencher os assets visuais e seguir o checklist em `play-store/release-checklist.md` para publicar.
