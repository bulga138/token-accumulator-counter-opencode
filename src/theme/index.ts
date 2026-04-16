import chalk, { type ChalkInstance } from 'chalk'
import { execSync } from 'child_process'
import { platform } from 'os'

export type Theme = 'dark' | 'light'

export interface ColorPalette {
  header: ChalkInstance
  activeTab: ChalkInstance
  inactiveTab: ChalkInstance
  border: ChalkInstance
  label: ChalkInstance
  value: ChalkInstance
  highlight: ChalkInstance
  warning: ChalkInstance
  info: ChalkInstance
  muted: ChalkInstance
  /** Subtle background tint applied to alternating table rows. */
  stripe: ChalkInstance
}

// Dark palette — optimised for dark/black terminal backgrounds
const DARK: ColorPalette = {
  header: chalk.hex('#FFA500'),
  activeTab: chalk.bgHex('#2E7D32').white,
  inactiveTab: chalk.hex('#757575'),
  border: chalk.hex('#424242'),
  label: chalk.hex('#90CAF9'),
  value: chalk.hex('#FFFFFF'),
  highlight: chalk.hex('#4CAF50'),
  warning: chalk.hex('#FFC107'),
  info: chalk.hex('#2196F3'),
  muted: chalk.hex('#9E9E9E'),
  // Very dark navy — just enough to distinguish alternate rows without
  // overwhelming the foreground colors on dark backgrounds.
  stripe: chalk.bgHex('#0D1117'),
}

// Light palette — same hue families, darker shades for white/light backgrounds
const LIGHT: ColorPalette = {
  header: chalk.hex('#E65100'),
  activeTab: chalk.bgHex('#1B5E20').white,
  inactiveTab: chalk.hex('#616161'),
  border: chalk.hex('#BDBDBD'),
  label: chalk.hex('#1565C0'),
  value: chalk.hex('#212121'),
  highlight: chalk.hex('#2E7D32'),
  warning: chalk.hex('#F57F17'),
  info: chalk.hex('#0D47A1'),
  muted: chalk.hex('#757575'),
  // Very light gray — subtle band that doesn't clash with colored text on
  // light backgrounds.
  stripe: chalk.bgHex('#F0F0F0'),
}

let _cachedTheme: Theme | null = null

/**
 * Detect the terminal background theme using:
 *   1. TACO_THEME env var (dark | light | auto)
 *   2. COLORFGBG env var (set by some terminals)
 *   3. macOS AppleInterfaceStyle preference
 *   4. Default: dark
 */
export function detectTheme(): Theme {
  if (_cachedTheme !== null) return _cachedTheme

  const explicit = process.env['TACO_THEME']?.toLowerCase()

  if (explicit === 'dark') return (_cachedTheme = 'dark')
  if (explicit === 'light') return (_cachedTheme = 'light')

  // Unrecognised non-auto value — warn once and fall through to detection
  if (explicit && explicit !== 'auto') {
    process.stderr.write(
      `taco: unknown TACO_THEME="${process.env['TACO_THEME']}", expected dark|light|auto — falling back to auto-detect\n`
    )
  }

  // COLORFGBG="foreground;background" — last segment is background ANSI index
  // ANSI colors 0-6 are dark, 7+ (especially 15 = white) are light
  const colorfgbg = process.env['COLORFGBG']
  if (colorfgbg) {
    const parts = colorfgbg.split(';')
    const bg = parseInt(parts[parts.length - 1] ?? '', 10)
    if (!isNaN(bg)) {
      return (_cachedTheme = bg >= 7 ? 'light' : 'dark')
    }
  }

  // macOS: query system dark mode preference
  if (platform() === 'darwin') {
    try {
      const result = execSync('defaults read -g AppleInterfaceStyle 2>/dev/null', {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      // Returns "Dark" when dark mode is enabled; fails/empty when light mode
      return (_cachedTheme = result.toLowerCase() === 'dark' ? 'dark' : 'light')
    } catch {
      // defaults read exits non-zero in light mode (no value set)
      return (_cachedTheme = 'light')
    }
  }

  // Default to dark — most terminal users run dark themes
  return (_cachedTheme = 'dark')
}

/**
 * Returns the color palette for the given theme, or the auto-detected theme
 * if none is specified.
 */
export function getColors(theme?: Theme): ColorPalette {
  return (theme ?? detectTheme()) === 'light' ? LIGHT : DARK
}

/** Reset the cached theme (useful for testing). */
export function resetThemeCache(): void {
  _cachedTheme = null
}
