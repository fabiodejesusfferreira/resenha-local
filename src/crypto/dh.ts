import sodium from 'react-native-libsodium';

/**
 * Diffie-Hellman bruto em X25519, construído em cima de crypto_box_easy.
 *
 * POR QUE ISSO EXISTE: o handshake efêmero (handshake.ts) e o Double
 * Ratchet (doubleRatchet.ts) precisam combinar VÁRIOS resultados de
 * Diffie-Hellman bruto antes de derivar qualquer chave — isso é o
 * coração de ambos os protocolos. O jeito padrão de fazer isso em
 * libsodium é `crypto_scalarmult` (DH puro) ou `crypto_box_beforenm`
 * (DH + HSalsa20). NENHUMA das duas existe nesta build do
 * react-native-libsodium — confirmado em teste real em dispositivo
 * (ver Object.keys(sodium) mais cedo nesta conversa). Só
 * `crypto_box_easy`/`crypto_box_open_easy` estão disponíveis.
 *
 * A CONSTRUÇÃO: crypto_box_easy(mensagem, nonce, pk_destino, sk_remetente)
 * faz internamente:
 *   1. compartilhado = X25519(sk_remetente, pk_destino)
 *   2. subchave      = HSalsa20(compartilhado, nonce[0:16])   <- == crypto_box_beforenm
 *   3. saída         = XSalsa20(subchave, nonce[16:24]) XOR mensagem, + tag Poly1305
 *
 * Fixando mensagem = 32 bytes zerados e nonce = 24 bytes zerados (os
 * dois lados usam exatamente os mesmos valores fixos — não é reuso de
 * nonce sobre conteúdo real, é "emprestar" o mecanismo interno do box),
 * a etapa 3 vira:
 *   saída = XSalsa20_keystream(subchave, 0) XOR 0 = XSalsa20_keystream(subchave, 0)
 * Ou seja: os primeiros 32 bytes da saída de
 * crypto_box_easy(zeros32, zeros24, pk, sk) são uma função determinística
 * só da "subchave" — exatamente o que crypto_box_beforenm(pk, sk)
 * produziria. Por simetria do X25519 (X25519(skA,pkB) === X25519(skB,pkA)),
 * os dois lados de uma conexão chegam ao MESMO valor — a propriedade que
 * precisamos de um Diffie-Hellman.
 *
 * RESSALVA TÉCNICA HONESTA: esta é uma construção não padronizada — não é
 * `crypto_scalarmult` puro, é uma reconstrução em cima de uma primitiva de
 * nível mais alto, através da única porta de entrada que este binding
 * disponibiliza. Ela não inventa nenhuma cifra nova (crypto_box é uma
 * primitiva pública, revisada e amplamente auditada do libsodium), mas é
 * uma composição específica deste projeto, não um padrão da indústria. Se
 * o binding instalado passar a expor `crypto_scalarmult` ou
 * `crypto_box_beforenm` diretamente no futuro, troque a implementação
 * interna desta função para usá-las — a assinatura pública não muda.
 *
 * Ver docs/crypto-architecture.md para a justificativa completa e
 * docs/threat-model.md para os riscos residuais dessa escolha.
 */

const ZERO_NONCE = new Uint8Array(sodium.crypto_box_NONCEBYTES); // 24 bytes
const ZERO_MESSAGE = new Uint8Array(32);

/**
 * Copia um Uint8Array nativo JSI (cujo .buffer é inacessível no Hermes)
 * para um Uint8Array puramente JS, byte a byte — sem usar .set() nem
 * .buffer. Qualquer resultado de sodium.* deve passar por aqui antes de
 * ser consumido por código JS downstream.
 */
function jsOwned(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) copy[i] = bytes[i];
  return copy;
}

function isAllZero(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

/**
 * Calcula o segredo Diffie-Hellman bruto (32 bytes) entre nossa chave
 * privada e a chave pública de outra parte. Lança erro se o resultado for
 * degenerado (todos-zero) — sinal de uma chave pública de baixa ordem,
 * possivelmente maliciosa. Essa checagem é "best-effort": como não temos
 * acesso ao ponto X25519 cru (só ao resultado já passado por HSalsa20),
 * ela não é tão completa quanto a validação de subgrupo pequeno que uma
 * implementação com crypto_scalarmult conseguiria fazer — ver
 * docs/threat-model.md, item "chave pública degenerada/maliciosa".
 */
export function rawDiffieHellman(ourPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  const boxOutput = sodium.crypto_box_easy(ZERO_MESSAGE, ZERO_NONCE, theirPublicKey, ourPrivateKey);
  // Primeiro copiamos boxOutput INTEIRO para um buffer JS puro, depois
  // fatiamos — evita qualquer acesso downstream ao buffer JSI nativo.
  const owned = jsOwned(boxOutput);
  const shared = owned.slice(0, 32); // owned é JS-owned: .slice() é seguro

  if (isAllZero(shared)) {
    throw new Error(
      'Diffie-Hellman resultou em segredo degenerado — a chave pública do contato pode ser inválida.'
    );
  }

  return shared;
}
