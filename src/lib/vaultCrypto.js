const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const defaultIterations = 210000;

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("当前环境不支持安全加密，请升级浏览器或使用新版桌面端");
  }

  return globalThis.crypto;
}

async function deriveVaultKey(masterPassword, salt, iterations) {
  const cryptoApi = getCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    "raw",
    textEncoder.encode(String(masterPassword || "")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function hasVaultCryptoSupport() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

export async function encryptVaultPayload(payload, masterPassword) {
  if (String(masterPassword || "").length < 6) {
    throw new Error("保险箱主密码至少需要 6 位");
  }

  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(masterPassword, salt, defaultIterations);
  const encodedPayload = textEncoder.encode(JSON.stringify(payload || {}));
  const encryptedBuffer = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, encodedPayload);

  return {
    version: "v1",
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: defaultIterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptVaultPayload(encrypted, masterPassword) {
  if (!encrypted?.salt || !encrypted?.iv || !encrypted?.ciphertext) {
    throw new Error("这条安全速记缺少密文，无法解锁");
  }

  const cryptoApi = getCrypto();
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const iterations = Number.parseInt(encrypted.iterations || String(defaultIterations), 10);
  const key = await deriveVaultKey(masterPassword, salt, Number.isFinite(iterations) ? iterations : defaultIterations);
  const decryptedBuffer = await cryptoApi.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const text = textDecoder.decode(decryptedBuffer);

  return JSON.parse(text);
}
