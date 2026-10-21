declare module 'claude-code' {
  interface PluginState {
    'skill-router': {
      /** True while switched off (it ships on). */
      isOff: boolean
      /** Skills hinted this session, in order. */
      hinted: string[]
    }
  }
}
