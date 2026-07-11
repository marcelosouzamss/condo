import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

const STAFF_ROLES = new Set([
  'admin',
  'syndic',
  'administrator',
  'collaborator',
  'doorman',
]);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash || hash.trim() === '') {
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** Retorna mensagem de erro ou null se válida. */
export function validatePasswordPolicy(password: string, role: string): string | null {
  if (password.length < 8) {
    return 'Senha deve ter no minimo 8 caracteres.';
  }
  if (STAFF_ROLES.has(role)) {
    if (password.length < 10) {
      return 'Senha de equipe deve ter no minimo 10 caracteres.';
    }
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    if (!hasLetter || !hasDigit) {
      return 'Senha de equipe deve conter letras e numeros.';
    }
  }
  return null;
}
