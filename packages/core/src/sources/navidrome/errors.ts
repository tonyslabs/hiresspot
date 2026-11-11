export type NavidromeErrorKind =
  | 'config' // URL o credenciales mal formadas
  | 'network' // sin conexión, DNS, timeout
  | 'http' // respuesta HTTP distinta de 2xx
  | 'protocol' // el servidor no habla Subsonic
  | 'auth' // credenciales rechazadas / sin permiso
  | 'api'; // error devuelto por la API

export class NavidromeError extends Error {
  constructor(
    public readonly kind: NavidromeErrorKind,
    message: string,
    public readonly code?: number
  ) {
    super(message);
    this.name = 'NavidromeError';
  }
}

/** Mensajes en español para los códigos de error de Subsonic. */
export const subsonicErrorMessage = (code: number, fallback?: string): string => {
  switch (code) {
    case 10:
      return 'Falta un parámetro en la petición.';
    case 20:
      return 'El servidor exige una versión más nueva del cliente.';
    case 30:
      return 'El servidor es demasiado antiguo para este cliente.';
    case 40:
      return 'Usuario o contraseña incorrectos.';
    case 41:
      return 'El servidor no admite autenticación por token (¿LDAP/proxy?).';
    case 42:
    case 43:
      return 'Mecanismo de autenticación no soportado por el servidor.';
    case 44:
      return 'Clave de API inválida.';
    case 50:
      return 'El usuario no tiene permiso para esta acción.';
    case 70:
      return 'No se encontró lo pedido en el servidor.';
    default:
      return fallback || `Error del servidor (código ${code}).`;
  }
};

export const isAuthCode = (code: number): boolean => code === 40 || code === 41 || code === 42 || code === 43 || code === 44 || code === 50;
