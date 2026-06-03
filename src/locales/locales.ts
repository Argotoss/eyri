export const locales: Record<string, Record<string, string>> = {
  en: {
    start: `Eyri (Icelandic "penny") manages your investment performance.\n\nUse /purchase to record buys and sells.\nUse /tickers to see your positions performance.\nUse /ticker to see concise performance.\nUse /intel to build a market intelligence report.\nUse /history to see your purchase history.`,
    buy: `To add a position purchase item, use this format:\n\n<code>/buy [ticker] [price] [commission] [amount]</code>`,
    purchase: `To record a buy or sell, use this format:\n\n<code>/purchase [ticker] [price] [amount] [commission%]</code>\n\nCommission is optional and is interpreted as a percent. Use a negative amount to sell.`,
    bought: `Position purchase item has been successfully added.\n\nUse /tickers to see your positions performance.`,
    no_positions: `You don't have any positions yet.\n\nUse /buy to add a position purchase item.`,
    when: `To see hypothetical performance, use this format:\n\n<code>/when TICKER=price TICKER2=price2 ...</code>`,
    decorate: `To decorate a ticker, use this format:\n\n<code>/decorate TICKER EMOJI</code>`,
    label: `To set or hide a ticker label, use this format:\n\n<code>/label TICKER LABEL</code>\n\nUse <code>false</code> as the label to hide it.`,
    link: `To link a ticker label, use this format:\n\n<code>/link TICKER TAG</code>\n\nUse <code>false</code> as the tag to remove it.`,
  },
};
