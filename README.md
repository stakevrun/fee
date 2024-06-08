# vrün fee info server

API endpoint for information about Vrün users' payments and charges.

All routes are GET requests that return `application/json` content.

## Payments

Route: `/<chainId>/<address>/payments[?token=<token address>&...]`

Returns the payments made to Vrün for user `<address>` (the address of the
Rocket Pool node). The `token` query parameter can be provided zero or more
times. If not provided, all accepted tokens are considered.

The object returned has the following format:
```
{ <token address, hex: string>:
    [ { "amount":    <unsigned integer, decimal: string>,
        "timestamp": <Unix epoch seconds: number>,
        "tx":        <transaction hash, hex: string> }
    , ... ]
, ... }
```

## Charges

Route: `/<chainId>/<address>/<pubkey>/charges`

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

Route: `/<chainId>/<address>/rp-fee-recipient`

Returns the current fee recipient (address: hex string) that the Rocket Pool
node `<address>` should use, based on its smoothing pool registration status.
