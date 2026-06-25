/**
 * Double Ratchet (mesmo algoritmo usado pelo Signal), com DH Ratchet +
 * Symmetric Ratchet, cadeias independentes de envio/recebimento, chaves
 * puladas para mensagens fora de ordem, e descarte imediato de chaves
 * usadas. Ver docs/crypto-architecture.md para os diagramas completos.
 *
 * DESIGN: a lógica do algoritmo (este arquivo) é separada das primitivas
 * criptográficas reais (createSodiumRatchetPrimitives, no fim do arquivo)
 * através da interface RatchetPrimitives. Isso permite testar a máquina
 * de estados inteira — avanço de cadeia, chaves puladas, passos de DH
 * ratchet, política de descarte — com primitivas falsas e determinísticas
 * via Node (ver tests/doubleRatchet.test.ts), sem precisar do dispositivo
 * físico nem do binding nativo do libsodium para validar a CORREÇÃO DO
 * ALGORITMO. A corretude das primitivas reais (dh.ts, hkdf.ts) é uma
 * preocupação separada, documentada e testável à parte.
 */

export type DHKeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

export type RatchetHeader = {
  dhPublicKey: Uint8Array;
  previousChainLength: number; // "PN" na notação do Signal
  messageNumber: number; // "N" na notação do Signal
};

export type RatchetMessage = {
  header: RatchetHeader;
  ciphertext: Uint8Array;
};

export type RatchetState = {
  dhSelf: DHKeyPair;
  dhRemote: Uint8Array | null;
  rootKey: Uint8Array;
  sendChainKey: Uint8Array | null;
  recvChainKey: Uint8Array | null;
  sendMessageNumber: number;
  recvMessageNumber: number;
  previousChainLength: number;
  /** chave: `${base64(dhPublicKey)}:${messageNumber}` -> chave de mensagem (32 bytes) */
  skippedKeys: Map<string, Uint8Array>;
};

export interface RatchetPrimitives {
  generateDHKeyPair(): DHKeyPair;
  dh(ourPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array;
  kdfRootKey(rootKey: Uint8Array, dhOutput: Uint8Array): { rootKey: Uint8Array; chainKey: Uint8Array };
  kdfChainKey(chainKey: Uint8Array): { nextChainKey: Uint8Array; messageKey: Uint8Array };
  encrypt(messageKey: Uint8Array, plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array;
  decrypt(messageKey: Uint8Array, ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array;
  toBase64(bytes: Uint8Array): string;
}

/** Limite duro de quantas chaves puladas ficam guardadas por conversa —
 *  evita crescimento indefinido do banco caso mensagens nunca cheguem.
 *  Eviction é FIFO (a mais antiga sai primeiro). No nosso modelo P2P sem
 *  servidor, mensagens "perdidas" não ficam em fila em lugar nenhum à
 *  espera de entrega futura — então, na prática, esse cenário só importa
 *  para mensagens que cruzam em trânsito numa mesma conexão ativa, não
 *  para longos períodos offline. Ver docs/threat-model.md. */
const MAX_SKIPPED_KEYS = 100;

/** Quantas mensagens uma única chamada pode "pular de uma vez" antes de
 *  desistir — proteção contra um contato malicioso anunciando um número
 *  de mensagem absurdamente alto para forçar o app a derivar milhares de
 *  chaves (uso de CPU/memória como negação de serviço). */
const MAX_SKIP_PER_CHAIN = 1000;

function skippedKeyId(dhPublicKey: Uint8Array, n: number, primitives: RatchetPrimitives): string {
  return `${primitives.toBase64(dhPublicKey)}:${n}`;
}

function trimSkippedKeys(state: RatchetState): void {
  while (state.skippedKeys.size > MAX_SKIPPED_KEYS) {
    const oldestKey = state.skippedKeys.keys().next().value;
    if (oldestKey === undefined) break;
    state.skippedKeys.delete(oldestKey);
  }
}

function encodeHeaderForAAD(header: RatchetHeader): Uint8Array {
  const pn = numberToBytes(header.previousChainLength);
  const n = numberToBytes(header.messageNumber);
  const combined = new Uint8Array(header.dhPublicKey.length + pn.length + n.length);
  combined.set(header.dhPublicKey, 0);
  combined.set(pn, header.dhPublicKey.length);
  combined.set(n, header.dhPublicKey.length + pn.length);
  return combined;
}

function numberToBytes(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (n >>> 24) & 0xff;
  buf[1] = (n >>> 16) & 0xff;
  buf[2] = (n >>> 8) & 0xff;
  buf[3] = n & 0xff;
  return buf;
}

function skipMessageKeys(
  state: RatchetState,
  until: number,
  primitives: RatchetPrimitives
): void {
  if (state.recvChainKey === null) return;

  if (until - state.recvMessageNumber > MAX_SKIP_PER_CHAIN) {
    throw new Error(
      'Número de mensagens puladas excede o limite de segurança — possível ataque ou perda grave de sincronia.'
    );
  }

  while (state.recvMessageNumber < until) {
    const { nextChainKey, messageKey } = primitives.kdfChainKey(state.recvChainKey);
    const id = skippedKeyId(state.dhRemote!, state.recvMessageNumber, primitives);
    state.skippedKeys.set(id, messageKey);
    trimSkippedKeys(state);
    state.recvChainKey = nextChainKey;
    state.recvMessageNumber += 1;
  }
}

function dhRatchetStep(state: RatchetState, theirNewPublicKey: Uint8Array, primitives: RatchetPrimitives): void {
  state.previousChainLength = state.sendMessageNumber;
  state.sendMessageNumber = 0;
  state.recvMessageNumber = 0;
  state.dhRemote = theirNewPublicKey;

  const recvDerived = primitives.kdfRootKey(state.rootKey, primitives.dh(state.dhSelf.privateKey, state.dhRemote));
  state.rootKey = recvDerived.rootKey;
  state.recvChainKey = recvDerived.chainKey;

  state.dhSelf = primitives.generateDHKeyPair();

  const sendDerived = primitives.kdfRootKey(state.rootKey, primitives.dh(state.dhSelf.privateKey, state.dhRemote));
  state.rootKey = sendDerived.rootKey;
  state.sendChainKey = sendDerived.chainKey;
}

/**
 * Inicializa o ratchet do lado "iniciador" (papel "Alice" do Signal — quem
 * tem a chave de identidade "menor" no desempate determinístico, ver
 * handshake.ts). Já sai com uma cadeia de ENVIO pronta, porque o
 * iniciador já conhece a chave DH efêmera do outro lado.
 */
export function initRatchetAsInitiator(
  sharedSecret: Uint8Array,
  ourEphemeralKeyPair: DHKeyPair,
  theirEphemeralPublicKey: Uint8Array,
  primitives: RatchetPrimitives
): RatchetState {
  const { rootKey, chainKey } = primitives.kdfRootKey(
    sharedSecret,
    primitives.dh(ourEphemeralKeyPair.privateKey, theirEphemeralPublicKey)
  );

  return {
    dhSelf: ourEphemeralKeyPair,
    dhRemote: theirEphemeralPublicKey,
    rootKey,
    sendChainKey: chainKey,
    recvChainKey: null,
    sendMessageNumber: 0,
    recvMessageNumber: 0,
    previousChainLength: 0,
    skippedKeys: new Map(),
  };
}

/**
 * Inicializa o ratchet do lado "respondedor" (papel "Bob"). Não tem
 * cadeia de envio nem de recebimento ainda — as duas só nascem quando a
 * primeira mensagem do iniciador chega (e dispara o primeiro passo do DH
 * ratchet em ratchetDecrypt).
 */
export function initRatchetAsResponder(sharedSecret: Uint8Array, ourEphemeralKeyPair: DHKeyPair): RatchetState {
  return {
    dhSelf: ourEphemeralKeyPair,
    dhRemote: null,
    rootKey: sharedSecret,
    sendChainKey: null,
    recvChainKey: null,
    sendMessageNumber: 0,
    recvMessageNumber: 0,
    previousChainLength: 0,
    skippedKeys: new Map(),
  };
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
  primitives: RatchetPrimitives
): RatchetMessage {
  if (state.sendChainKey === null) {
    throw new Error(
      'Cadeia de envio ainda não inicializada — aguardando a primeira mensagem do outro lado (papel respondedor).'
    );
  }

  const { nextChainKey, messageKey } = primitives.kdfChainKey(state.sendChainKey);
  const header: RatchetHeader = {
    dhPublicKey: state.dhSelf.publicKey,
    previousChainLength: state.previousChainLength,
    messageNumber: state.sendMessageNumber,
  };

  const ciphertext = primitives.encrypt(messageKey, plaintext, encodeHeaderForAAD(header));

  state.sendChainKey = nextChainKey;
  state.sendMessageNumber += 1;

  return { header, ciphertext };
}

export function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage,
  primitives: RatchetPrimitives
): Uint8Array {
  const skippedId = skippedKeyId(message.header.dhPublicKey, message.header.messageNumber, primitives);
  const skippedKey = state.skippedKeys.get(skippedId);
  if (skippedKey) {
    state.skippedKeys.delete(skippedId);
    return primitives.decrypt(skippedKey, message.ciphertext, encodeHeaderForAAD(message.header));
  }

  const isNewDhKey =
    state.dhRemote === null || primitives.toBase64(state.dhRemote) !== primitives.toBase64(message.header.dhPublicKey);

  if (isNewDhKey) {
    if (state.dhRemote !== null) {
      skipMessageKeys(state, message.header.previousChainLength, primitives);
    }
    dhRatchetStep(state, message.header.dhPublicKey, primitives);
  }

  skipMessageKeys(state, message.header.messageNumber, primitives);

  const { nextChainKey, messageKey } = primitives.kdfChainKey(state.recvChainKey!);
  state.recvChainKey = nextChainKey;
  state.recvMessageNumber += 1;

  return primitives.decrypt(messageKey, message.ciphertext, encodeHeaderForAAD(message.header));
}

// --- Primitivas reais (libsodium), usadas em produção -----------------

/**
 * Copia src (Uint8Array nativo JSI) para um Uint8Array JS puro, byte a
 * byte, sem acessar .buffer nem .set(). O binding react-native-libsodium
 * retorna Uint8Array JSI cujo .buffer é undefined no Hermes; funções como
 * crypto_aead_xchacha20poly1305_ietf_encrypt falham com "input type not
 * yet implemented" ao receber esses objetos. Copiar byte a byte produz um
 * Uint8Array puramente JS, aceito por qualquer função do binding.
 * Idêntico ao jsOwned em hkdf.ts — mantido local para não criar acoplamento.
 */
function jsOwned(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
  return dst;
}

export function createSodiumRatchetPrimitives(
  sodium: any,
  hkdfExpand: (key: Uint8Array, info: Uint8Array, length: number) => Uint8Array,
  hkdfFull: (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => Uint8Array,
  rawDiffieHellman: (sk: Uint8Array, pk: Uint8Array) => Uint8Array,
  toBase64: (bytes: Uint8Array) => string,
  utf8Encode: (text: string) => Uint8Array
): RatchetPrimitives {
  return {
    generateDHKeyPair: () => {
      const kp = sodium.crypto_box_keypair();
      // crypto_box_keypair retorna Uint8Array JSI — copiar para JS puro
      // para que operações DH e encodeHeaderForAAD não propaguem o tipo nativo.
      return { publicKey: jsOwned(kp.publicKey), privateKey: jsOwned(kp.privateKey) };
    },
    dh: (ourPrivateKey, theirPublicKey) => rawDiffieHellman(ourPrivateKey, theirPublicKey),
    kdfRootKey: (rootKey, dhOutput) => {
      const output = hkdfFull(rootKey, dhOutput, utf8Encode('resenha-local:ratchet-root'), 64);
      return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
    },
    kdfChainKey: (chainKey) => ({
      nextChainKey: hkdfExpand(chainKey, utf8Encode('resenha-local:chain'), 32),
      messageKey: hkdfExpand(chainKey, utf8Encode('resenha-local:message'), 32),
    }),
    encrypt: (messageKey, plaintext, associatedData) => {
      // randombytes_buf retorna Uint8Array JSI — converter para JS puro
      // antes de passar para o encrypt, que não aceita tipo JSI nativo.
      const nonce = jsOwned(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES));
      const ciphertext = jsOwned(
        sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          plaintext,
          associatedData,
          null,
          nonce,
          messageKey
        )
      );
      const combined = new Uint8Array(nonce.length + ciphertext.length);
      combined.set(nonce, 0);
      combined.set(ciphertext, nonce.length);
      return combined;
    },
    decrypt: (messageKey, combined, associatedData) => {
      const nonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
      const nonce = combined.slice(0, nonceLength);
      const ciphertext = combined.slice(nonceLength);
      return jsOwned(
        sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, associatedData, nonce, messageKey)
      );
    },
    toBase64,
  };
}
