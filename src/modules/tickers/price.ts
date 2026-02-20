const API_URL = "https://stooq.com";

export async function fetchTickerPrice(ticker: string) {
  try {
    const response = await fetch(`${API_URL}/q/l/?s=${ticker}`);
    const data = await response.text();
    const price = data.split(",").at(6) ?? null;
    return price ? Number(price) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}
