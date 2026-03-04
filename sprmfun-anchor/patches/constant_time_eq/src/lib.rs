// Minimal shim of constant_time_eq 0.4.2 compatible with Rust < 1.85.
// The real crate uses edition2024 which requires rustc 1.85+.
// This shim exposes the same public API used by bcrypt/argon2 etc.

#[inline]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

#[inline]
pub fn constant_time_eq_n<const N: usize>(a: &[u8; N], b: &[u8; N]) -> bool {
    let mut acc: u8 = 0;
    for i in 0..N {
        acc |= a[i] ^ b[i];
    }
    acc == 0
}
