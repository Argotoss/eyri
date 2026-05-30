import { validateEnv } from "../../utils/env.ts";
import { createBot } from "../bot/setup.ts";

export async function startApp() {
  try {
    validateEnv(["TOKEN", "ADMIN_ID"]);
  } catch (error) {
    console.error("Error occurred while loading environment:", error);
    Deno.exit(1);
  }

  try {
    console.log("Starting bot...");
    const bot = createBot();

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
}
