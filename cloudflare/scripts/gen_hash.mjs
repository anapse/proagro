// Genera el hash PBKDF2 de la contraseña inicial del admin (SOLO para el seed).
// Formato: pbkdf2$sha256$<iter>$<salt_b64>$<hash_b64>
// El Worker verificará con crypto.subtle (WebCrypto) usando el mismo formato.
// La contraseña en texto plano NUNCA se guarda: solo se usa aquí para derivar.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) { console.error("Uso: node gen_hash.mjs <password>"); process.exit(1); }
const iter = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iter, 32, "sha256");
console.log(`pbkdf2$sha256$${iter}$${salt.toString("base64")}$${hash.toString("base64")}`);
