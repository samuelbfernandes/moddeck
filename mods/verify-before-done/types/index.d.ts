declare module 'claude-code' {
  interface PluginState {
    'verify-before-done': {
      /** True while switched off (it ships on). */
      isOff: boolean
      /** Turns this session that changed code and ran no test, check or build. */
      unverified: number
    }
  }
}
