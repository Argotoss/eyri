import { refetchPrices } from "../../jobs/fetch-prices.ts";
import { validateEnv } from "../../utils/env.ts";
import { createBot } from "../bot/setup.ts";
import type { Database } from "../database/setup.ts";
import { connectToDb } from "../database/setup.ts";

export async function startApp() {
  try {
    validateEnv(["TOKEN", "DB_CONNECTION_STRING"]);
  } catch (error) {
    console.error("Error occurred while loading environment:", error);
    Deno.exit(1);
  }

  let database: Database;
  try {
    console.log("Connecting to database...");
    database = await connectToDb();
    console.log(`Database connected`);
  } catch (error) {
    console.error("Error occurred while connecting to the database:", error);
    Deno.exit(2);
  }

  try {
    console.log("Starting bot...");
    const bot = createBot(database);

    await new Promise((resolve) =>
      bot.start({
        onStart: () => resolve(undefined),
      }),
    );
    console.log("Bot started");
  } catch (error) {
    console.error("Error occurred while starting the bot:", error);
    Deno.exit(4);
  }

  try {
    console.log("Refetching initial prices...");
    await refetchPrices(database);
    console.log("Setting up cron job...");
    Deno.cron("refetch prices", "*/5 * * * *", async () => {
      await refetchPrices(database);
    });
    console.log("Cron job set up");
  } catch (error) {
    console.error("Error occurred while setting up cron job:", error);
    Deno.exit(5);
  }
}
