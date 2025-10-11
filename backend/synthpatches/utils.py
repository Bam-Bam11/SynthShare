# utils.py

"""
Small helpers shared across models.
- Base-32 conversion for fork/edit indices (digits 0-9 and a-v).
- Version parsing utilities.
"""

BASE32_ALPHABET = "0123456789abcdefghijklmnopqrstuv"


def to_base32(n: int) -> str:
    """Convert non-negative int to base-32 string using BASE32_ALPHABET."""
    if n < 0:
        raise ValueError("to_base32 expects a non-negative integer")
    if n == 0:
        return "0"
    out = []
    while n > 0:
        out.append(BASE32_ALPHABET[n % 32])
        n //= 32
    return "".join(reversed(out))


def from_base32(s: str) -> int:
    """Convert base-32 string (using BASE32_ALPHABET) to int."""
    if not s:
        raise ValueError("from_base32 expects a non-empty string")
    n = 0
    for ch in s:
        try:
            n = n * 32 + BASE32_ALPHABET.index(ch)
        except ValueError as e:
            raise ValueError(f"Invalid base-32 digit: {ch!r}") from e
    return n


def parse_version(version: str) -> tuple[str, str, int, int]:
    """
    Parse a version string like 'a.3' into:
    (fork_str, edit_str, fork_int, edit_int)
    where fork_int/edit_int are base-10 ints.
    """
    try:
        fork_str, edit_str = version.split(".", 1)
    except ValueError as e:
        raise ValueError(f"Invalid version format: {version!r}") from e
    return fork_str, edit_str, from_base32(fork_str), from_base32(edit_str)
