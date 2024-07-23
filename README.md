# vrün fee server

API endpoint for information about Vrün users' credits and charges, and to
validate and record payments.

All routes return `application/json` content.

## Credits

Route: `GET /<chainId>/<address>/credits`

Returns the number of Vrün validator days credited to user `<address>` (the
address of the Rocket Pool node). (Used days are included.)

If the `logs` query parameter is provided, returns a list of `CreditAccount`
log entries (instead of their net balance). The list returned has the following
format and is ordered by the timestamp:
```
[ { "timestamp":       <Unix epoch seconds, string>,
    "nodeAccount":     <address, string>,
    "numDays":         <decimal number, string>,
    "decreaseBalance:  <bool>,
    "chainId":         <decimal number, string>,
    "transactionHash": <32 bytes, hex string>,
    "reason":          <string> }
, ... ]
```

## Payment

Route: `PUT /<chainId>/<address>/pay`

TODO: Not implemented yet

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

Returns the current fee recipient (address: hex string) that the Rocket Pool
node `<address>` should use, based on its smoothing pool registration status.
