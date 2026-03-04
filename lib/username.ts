/**
 * Random unique username generator.
 * Produces names like "NeonWolf4823" and permanently maps them
 * to wallet addresses via localStorage.
 */

const ADJECTIVES = [
  'Apex', 'Atomic', 'Binary', 'Blazing', 'Chaotic', 'Cosmic', 'Crimson',
  'Crystal', 'Cyber', 'Dark', 'Delta', 'Digital', 'Eclipse', 'Electric',
  'Eternal', 'Fierce', 'Frost', 'Galactic', 'Ghost', 'Glitch', 'Golden',
  'Hyper', 'Infernal', 'Iron', 'Jade', 'Lunar', 'Neon', 'Omega', 'Onyx',
  'Phantom', 'Plasma', 'Primal', 'Quantum', 'Rapid', 'Rogue', 'Ruby',
  'Savage', 'Shadow', 'Silver', 'Sonic', 'Solar', 'Spectral', 'Static',
  'Steel', 'Storm', 'Swift', 'Turbo', 'Toxic', 'Ultra', 'Venom', 'Violet',
  'Void', 'Vortex', 'Wild', 'Xenon', 'Zero', 'Zenith', 'Blaze', 'Surge',
  'Flux', 'Nitro', 'Cipher', 'Relic', 'Obsidian', 'Ember', 'Cobalt',
]

const NOUNS = [
  'Archer', 'Assassin', 'Bandit', 'Baron', 'Blade', 'Cobra', 'Commander',
  'Crusader', 'Demon', 'Dragon', 'Drifter', 'Eagle', 'Falcon', 'Fox',
  'Gladiator', 'Hawk', 'Hunter', 'Hydra', 'Jackal', 'Knight', 'Legend',
  'Lynx', 'Mage', 'Mantis', 'Marauder', 'Maverick', 'Monk', 'Nova',
  'Oracle', 'Panther', 'Phoenix', 'Predator', 'Ranger', 'Raptor', 'Raven',
  'Reaper', 'Rex', 'Rider', 'Ronin', 'Sage', 'Scorpion', 'Sentinel',
  'Serpent', 'Shark', 'Slayer', 'Specter', 'Sphinx', 'Stalker', 'Tiger',
  'Titan', 'Viper', 'Warrior', 'Watcher', 'Wolf', 'Wraith', 'Zealot',
  'Zephyr', 'Spectre', 'Cipher', 'Ghost', 'Shade', 'Fury', 'Pulse',
]

const STORAGE_KEY = 'sprmfun:usernames'

/** Generate a fresh random name — NOT persisted. */
export function generateRandomName(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const num  = Math.floor(Math.random() * 9000) + 1000 // always 4 digits
  return `${adj}${noun}${num}`
}

/** Load the full address → username map from localStorage. */
export function getUsernameMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * Return the persisted username for `walletAddress`.
 * If none exists yet, generate one, save it, and return it.
 */
export function getOrCreateUsername(walletAddress: string): string {
  if (typeof window === 'undefined') return generateRandomName()
  try {
    const map = getUsernameMap()
    if (map[walletAddress]) return map[walletAddress]

    const name = generateRandomName()
    map[walletAddress] = name
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    return name
  } catch {
    return generateRandomName()
  }
}

/** Utility: first two uppercase letters of a username for avatar initials. */
export function usernameInitials(username: string): string {
  if (!username) return '??'
  return username.replace(/\d+$/, '').slice(0, 2).toUpperCase()
}

/**
 * Deterministically derive a username from any wallet address.
 * Same address ALWAYS produces the same name — no localStorage needed.
 * Used as a fallback for messages from other users.
 */
export function deriveUsername(walletAddress: string): string {
  if (!walletAddress || walletAddress.length < 8) return 'Unknown'
  // Simple djb2-style hash over the address string
  let h = 5381
  for (let i = 0; i < walletAddress.length; i++) {
    h = ((h << 5) + h) ^ walletAddress.charCodeAt(i)
    h = h >>> 0 // keep 32-bit unsigned
  }
  const adj  = ADJECTIVES[h % ADJECTIVES.length]
  const noun = NOUNS[(h >>> 8) % NOUNS.length]
  const num  = 1000 + ((h >>> 16) % 9000)
  return `${adj}${noun}${num}`
}
