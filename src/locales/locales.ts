export const locales: Record<string, Record<string, string>> = {
  en: {
    start: `Eyri (Icelandic "penny") shows your IBKR portfolio performance.\n\nUse /tickers to see your current positions.\nUse /perf to see concise performance.\nUse /history to see Flex trade history.\nUse /when to see hypothetical performance.`,
    buy_unsupported: `Positions are read from IBKR now, so /buy is no longer used.`,
    history_unavailable: `IBKR Flex trade history is not configured or unavailable.`,
    ibkr_connecting: `IBKR Gateway is still connecting. Try again in a moment.`,
    ibkr_unavailable: `IBKR Gateway is not available yet. Check that the gateway container is running and logged in.`,
    no_positions: `IBKR did not return any open positions.`,
    no_trades: `IBKR Flex did not return any trades.`,
    when: `To see hypothetical performance, use this format:\n\n<code>/when TICKER=price TICKER2=price2 ...</code>`,
    decorate: `To decorate a ticker, use this format:\n\n<code>/decorate TICKER EMOJI</code>`,
    label: `To show or hide a ticker label, use this format:\n\n<code>/label TICKER true|false</code>`,
  },
};
