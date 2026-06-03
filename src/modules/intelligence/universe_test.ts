import { parseSp500Html } from "./universe.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("parseSp500Html reads ticker, company, and sector", () => {
  const entries = parseSp500Html(`
    <table id="constituents">
      <tr><th>Symbol</th><th>Security</th><th>GICS Sector</th></tr>
      <tr>
        <td><a>NVDA</a></td>
        <td><a>Nvidia Corporation</a></td>
        <td>Information Technology</td>
      </tr>
      <tr>
        <td>BRK.B</td>
        <td>Berkshire Hathaway</td>
        <td>Financials</td>
      </tr>
    </table>
  `);

  assert(entries.length === 2, "expected two entries");
  assert(entries[0].ticker === "NVDA", "expected NVDA ticker");
  assert(
    entries[0].aliases.includes("Nvidia"),
    "expected simplified Nvidia alias",
  );
  assert(entries[1].ticker === "BRK.B", "expected BRK.B ticker");
});
