
BASE32_ALPHABET = '0123456789abcdefghijklmnopqrstuv'

def to_base32(n):
    if n == 0:
        return '0'
    digits = ''
    while n > 0:
        digits = BASE32_ALPHABET[n % 32] + digits
        n //= 32
    return digits


