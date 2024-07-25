# vrün fee server

API endpoint for information about Vrün users' credits and charges, and to
validate and record payments.

All routes return `application/json` content.

## Credits

Route: `GET /<chainId>/<address>/credits`

Returns the number of Vrün validator days credited to user `<address>` (the
address of the Rocket Pool node). (Used days are included.)

If the `logs` query parameter is provided (with a non-empty string value),
returns a list of `CreditAccount` log entries (instead of their net balance).
The list returned has the following format and is ordered by the timestamp:
```
[ { "timestamp":       <Unix epoch seconds, string>,
    "nodeAccount":     <address, string>,
    "numDays":         <decimal number, string>,
    "decreaseBalance:  <bool>,
    "chainId":         <decimal number, string>,
    "transactionHash": <32 bytes, hexstring>,
    "reason":          <string> }
, ... ]
```

## Prices

Route: `GET /<chainId>/prices`

Returns an object of the following format:
```
{
  "chainId":    <number>,
  "validUntil": <number, or "now">
  "pricesPerDay": {
      <tokenChainId, number>: {
          <tokenAddress, 0x-prefixed hexstring>:
              <pricePerDay, number, decimal string>, ...
      }, ...
  }
}
```
where `pricePerDay` is the price per Vrün validator day on chain `<chainId>`
for the ERC-20 token `<tokenAddress>` on chain `<tokenChainId>`, as a decimal
number string denominated in the smallest unit for the token.

We always accept payment in ETH, which is listed under token address
`0x0000000000000000000000000000000000000000`.

If the query parameter `timestamp` is provided and is a decimal string
representing seconds after the Unix epoch, return the price as it was at that
time.

The `validUntil` output field is either the string `"now"` (meaning the price
is currently valid), or a number of seconds after the Unix epoch after which
the prices per day may have changed.

## Payment

Route: `PUT /<chainId>/<address>/pay` TODO: Not implemented yet

Accepts `application/json`.

The input data is a object in the following format:
```
{
  "nodeAccount":     <address, 0x-prefixed hexstring>,
  "numDays":         <number, decimal string>,
  "tokenChainId":    <number, decimal string>,
  "tokenAddress":    <address, 0x-prefixed hexstring>,
  "transactionHash": <bytes32, 0x-prefixed hexstring>,
  "signature":       <signature, 0x-prefixed hexstring>
}
```
The signature should be an EIP-712 signature over the structure:
```
struct Pay {
  address nodeAccount;
  uint256 numDays;
  uint256 tokenChainId;
  address tokenAddress;
  bytes32 transactionHash;
}
```
with `EIP712Domain = {name: "vrün", version: "1", chainId: <chainId>}`, where
the `chainId` in the domain is the same as in the URL. (The `chainId` in the
`Pay` structure is the chain of the payment transaction, whereas the `chainId`
in the domain is the chain on which to credit the account.) The signature must
be from the sender of the payment transaction with hash `transactionHash`.

## Charges

Route: `GET /<chainId>/<address>/<pubkey>/charges`

Returns the chargeable days by Vrün for user `<address>` (the address of the
Rocket Pool node) for their validator identified by <pubkey>. The days are
grouped into contiguous intervals.

The array returned has the following format:
```
[ { "startTime": <start time for this interval, Unix epoch seconds: number>,
    "firstDay":  <first day of this interval in UTC, YYYY-MM-DD: string>,
    "endTime":   <end time for this interval>,
    "lastDay":   <last day of this interval>,
    "numDays":   <total number of days in this interval: number> }
, ... ]
```

## Rocket Pool Fee Recipient

Route: `GET /<chainId>/<address>/rp-fee-recipient`

Returns the current fee recipient (address: hexstring) that the Rocket Pool
node `<address>` should use, based on its smoothing pool registration status.
