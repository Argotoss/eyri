import {
  EventName,
  IBApi,
  type Contract,
  type IBApiCreationOptions,
} from "@stoqey/ib";
import { fetchFlexOpenDates } from "./flex.ts";

export type PortfolioPosition = {
  account: string;
  ticker: string;
  amount: number;
  averageUnitPrice: number | null;
  currentPrice: number | null;
  currency: string;
  totalInput: number | null;
  totalNow: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  openedAt: Date | null;
};

type IbkrConfig = Required<Pick<IBApiCreationOptions, "host" | "port">> & {
  accountId?: string;
  clientId: number;
  timeoutMs: number;
};

function getNumberEnv(name: string, fallback: number) {
  const value = Deno.env.get(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function getIbkrConfig(): IbkrConfig {
  const tradingMode = Deno.env.get("TRADING_MODE");
  const defaultPort = tradingMode === "live" ? 4003 : 4004;

  return {
    host: Deno.env.get("IBKR_HOST") ?? "127.0.0.1",
    port: getNumberEnv("IBKR_PORT", defaultPort),
    clientId: getNumberEnv("IBKR_CLIENT_ID", 0),
    accountId: Deno.env.get("IBKR_ACCOUNT_ID") || undefined,
    timeoutMs: getNumberEnv("IBKR_TIMEOUT_MS", 30_000),
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectOnce(config: IbkrConfig) {
  const api = new IBApi({ host: config.host, port: config.port });

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        api.off(EventName.connected, onConnected);
        api.off(EventName.error, onError);
      };
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const onError = (error: unknown) => {
        cleanup();
        reject(normalizeError(error));
      };

      api.once(EventName.connected, onConnected);
      api.once(EventName.error, onError);
      api.connect(config.clientId);
    }),
    config.timeoutMs,
    `Timed out connecting to IBKR Gateway at ${config.host}:${config.port}`,
  );

  return api;
}

async function connect(config: IbkrConfig) {
  const startedAt = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      return await connectOnce(config);
    } catch (error) {
      lastError = normalizeError(error);
      await wait(1_000);
    }
  }

  throw (
    lastError ??
    new Error(
      `Timed out connecting to IBKR Gateway at ${config.host}:${config.port}`,
    )
  );
}

async function getManagedAccount(api: IBApi, config: IbkrConfig) {
  if (config.accountId) {
    return config.accountId;
  }

  const accountIds = await withTimeout(
    new Promise<string[]>((resolve, reject) => {
      const cleanup = () => {
        api.off(EventName.managedAccounts, onManagedAccounts);
        api.off(EventName.error, onError);
      };
      const onManagedAccounts = (accounts: string) => {
        cleanup();
        resolve(accounts.split(",").filter(Boolean));
      };
      const onError = (error: unknown) => {
        cleanup();
        reject(normalizeError(error));
      };

      api.once(EventName.managedAccounts, onManagedAccounts);
      api.once(EventName.error, onError);
      api.reqManagedAccts();
    }),
    config.timeoutMs,
    "Timed out waiting for IBKR managed accounts",
  );

  const accountId = accountIds.at(0);
  if (!accountId) {
    throw new Error("IBKR Gateway returned no managed accounts");
  }

  return accountId;
}

function getTicker(contract: Contract) {
  return contract.localSymbol ?? contract.symbol ?? String(contract.conId);
}

function toPortfolioPosition(
  contract: Contract,
  amount: number,
  marketPrice: number,
  marketValue: number,
  averageCost: number | undefined,
  unrealizedPnl: number | undefined,
  realizedPnl: number | undefined,
  accountName: string | undefined,
): PortfolioPosition {
  const totalInput = averageCost === undefined ? null : averageCost * amount;

  return {
    account: accountName ?? "",
    ticker: getTicker(contract),
    amount,
    averageUnitPrice: averageCost ?? null,
    currentPrice: marketPrice === Number.MAX_VALUE ? null : marketPrice,
    currency: contract.currency ?? "USD",
    totalInput,
    totalNow: marketValue === Number.MAX_VALUE ? null : marketValue,
    unrealizedPnl: unrealizedPnl ?? null,
    realizedPnl: realizedPnl ?? null,
    openedAt: null,
  };
}

async function getAccountPortfolio(
  api: IBApi,
  accountId: string,
  config: IbkrConfig,
) {
  const positions = new Map<string, PortfolioPosition>();

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          api.off(EventName.updatePortfolio, onUpdatePortfolio);
          api.off(EventName.accountDownloadEnd, onAccountDownloadEnd);
          api.off(EventName.error, onError);
        };
        const onUpdatePortfolio = (
          contract: Contract,
          amount: number,
          marketPrice: number,
          marketValue: number,
          averageCost?: number,
          unrealizedPnl?: number,
          realizedPnl?: number,
          accountName?: string,
        ) => {
          if (amount === 0) {
            return;
          }

          const position = toPortfolioPosition(
            contract,
            amount,
            marketPrice,
            marketValue,
            averageCost,
            unrealizedPnl,
            realizedPnl,
            accountName,
          );
          positions.set(`${position.account}:${position.ticker}`, position);
        };
        const onAccountDownloadEnd = () => {
          cleanup();
          resolve();
        };
        const onError = (error: unknown) => {
          cleanup();
          reject(normalizeError(error));
        };

        api.on(EventName.updatePortfolio, onUpdatePortfolio);
        api.once(EventName.accountDownloadEnd, onAccountDownloadEnd);
        api.once(EventName.error, onError);
        api.reqAccountUpdates(true, accountId);
      }),
      config.timeoutMs,
      `Timed out waiting for IBKR account portfolio for ${accountId}`,
    );
  } finally {
    api.reqAccountUpdates(false, accountId);
  }

  return [...positions.values()].sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
}

export async function fetchPortfolioPositions() {
  const config = getIbkrConfig();
  const api = await connect(config);

  try {
    const accountId = await getManagedAccount(api, config);
    const positions = await getAccountPortfolio(api, accountId, config);
    const openDates = await fetchFlexOpenDates(positions).catch((error) => {
      console.error("Failed to fetch IBKR Flex trade history:", error);
      return new Map<string, Date>();
    });

    return positions.map((position) => ({
      ...position,
      openedAt: openDates.get(position.ticker) ?? null,
    }));
  } finally {
    api.disconnect();
  }
}

export async function probeIbkrConnection() {
  const config = getIbkrConfig();
  const api = await connect(config);

  try {
    await getManagedAccount(api, config);
  } finally {
    api.disconnect();
  }
}
