import { refreshPersistentPrice } from "../modules/database/price.ts";
import { Database } from "../modules/database/setup.ts";
import { getAllUsers, getPositions } from "../modules/database/user.ts";

export async function refetchPrices(database: Database) {
  const users = await getAllUsers(database);
  for (const user of users) {
    const tickers = Object.keys(getPositions(user));
    for (const ticker of tickers) {
      await refreshPersistentPrice(database, ticker);
    }
  }
}
