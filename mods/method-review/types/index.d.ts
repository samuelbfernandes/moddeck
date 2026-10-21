declare module 'claude-code' {
  interface PluginState {
    'method-review': {
      /** True while switched off (it ships on). */
      isOff: boolean
      /** Method files edited since the last review, as shown (relative where possible), oldest first, at most 50. */
      pending: string[]
    }
  }
}
