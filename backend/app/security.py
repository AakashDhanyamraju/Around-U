"""Password hashing and token generation.

bcrypt is used directly rather than through passlib: passlib 1.7.4 reads
`bcrypt.__about__.__version__`, which bcrypt removed in 4.1, producing a noisy
trapped error on every hash.
"""

import hmac
import secrets

import bcrypt

# bcrypt silently truncates at 72 bytes, so anything longer is rejected up front
# instead of two different passwords hashing to the same value.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError("Password is too long (max 72 bytes)")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(
            password.encode("utf-8")[:MAX_PASSWORD_BYTES],
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        # Malformed/legacy hash in the column — treat as a failed login.
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def new_email_token() -> str:
    return secrets.token_urlsafe(32)


def constant_time_equals(a: str, b: str) -> bool:
    """For comparing the admin shared secret without leaking length via timing."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
