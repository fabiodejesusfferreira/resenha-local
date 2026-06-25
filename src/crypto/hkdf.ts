import sodium from 'react-native-libsodium';

/**
 * KDF (derivação de chave) construída sobre BLAKE2b (crypto_generichash),
 * com a mesma interface Extract + Expand do HKDF-SHA256 (RFC 5869).
 *
 * POR QUE NÃO _unstable_crypto_kdf_hkdf_sha256_*:
 *   Essas funções crasham com "Value is undefined, expected an Object"
 *   no Hermes — provavelmente porque o binding repassa internamente um
 *   ArrayBuffer JSI que o motor não consegue desempacotar. Não há workaround
 *   confiável: mesmo convertendo para ArrayBuffer JS puro antes da chamada,
 *   o crash persiste dentro do binding nativo.
 *
 * POR QUE BLAKE2b (crypto_generichash):
 *   É a única primitiva de hash com suporte a chave (keyed mode) que este
 *   binding expõe de forma estável e confirmada em dispositivo físico.
 *   BLAKE2b em modo com chave é funcionalmente equivalente a HMAC —
 *   ambos realizam uma PRF (Pseudo-Random Function) sobre a entrada com
 *   uma chave secreta — então a construção abaixo é criptograficamente
 *   sólida para derivação de chaves.
 *
 * CONSTRUÇÃO (mesma lógica do HKDF, trocando HMAC-SHA256 por BLAKE2b-keyed):
 *
 *   Extract(salt, IKM):
 *     PRK = BLAKE2b-32(input=IKM, key=salt)
 *
 *   Expand(PRK, info, L):
 *     T(0)  = []  (vazio)
 *     T(i)  = BLAKE2b-32(input = T(i-1) || info || byte(i), key=PRK)
 *     OKM   = T(1) || T(2) || ... truncado em L bytes
 *
 * POR QUE jsOwned:
 *   crypto_generichash retorna Uint8Array nativo JSI cujo .buffer é
 *   undefined no Hermes. Copiar byte-a-byte (sem usar .set() nem
 *   .buffer.slice()) produz um Uint8Array puramente JS, seguro para
 *   qualquer consumidor downstream.
 */

const HASH_LEN = 32; // saída fixa do BLAKE2b neste binding

/**
 * Copia src (Uint8Array nativo JSI) para um Uint8Array JS puro,
 * byte a byte, sem acessar .buffer nem .set().
 */
function jsOwned(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
  return dst;
}

/**
 * BLAKE2b requer chave de 16–64 bytes. Se o sal for mais curto (ou
 * vazio — caso comum em HKDF sem sal explícito), completa com zeros até
 * 32 bytes — idêntico à convenção do RFC 5869 §2.2 para sal ausente.
 */
function normalizeSalt(salt: Uint8Array): Uint8Array {
  const MIN_KEY = 16;
  if (salt.length >= MIN_KEY) return salt;
  const padded = new Uint8Array(HASH_LEN); // zeros
  for (let i = 0; i < salt.length; i++) padded[i] = salt[i];
  return padded;
}

/** PRK = BLAKE2b(IKM, key=salt). */
export function hkdfExtract(salt: Uint8Array, inputKeyMaterial: Uint8Array): Uint8Array {
  return jsOwned(sodium.crypto_generichash(HASH_LEN, inputKeyMaterial, normalizeSalt(salt)));
}

/** OKM = T(1) || T(2) || … truncado em `length` bytes. */
export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const n = Math.ceil(length / HASH_LEN);
  const okm = new Uint8Array(n * HASH_LEN); // JS-owned, .slice() é seguro depois
  let prev: Uint8Array = new Uint8Array(0); // T(0) = vazio

  for (let i = 1; i <= n; i++) {
    // input = T(i-1) || info || byte(i)
    const input = new Uint8Array(prev.length + info.length + 1);
    for (let j = 0; j < prev.length; j++) input[j] = prev[j];
    for (let j = 0; j < info.length; j++) input[prev.length + j] = info[j];
    input[prev.length + info.length] = i;

    prev = jsOwned(sodium.crypto_generichash(HASH_LEN, input, prk));
    for (let j = 0; j < HASH_LEN; j++) okm[(i - 1) * HASH_LEN + j] = prev[j];
  }

  // okm é JS-owned: .slice() retorna um Uint8Array JS seguro
  return okm.slice(0, length);
}

/** Extract + Expand combinados. Assinatura idêntica à versão anterior. */
export function hkdf(
  salt: Uint8Array,
  inputKeyMaterial: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  const prk = hkdfExtract(salt, inputKeyMaterial);
  return hkdfExpand(prk, info, length);
}
