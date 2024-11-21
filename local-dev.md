# Run fee service locally

[!CAUTION]
Only run your local dev environment using a test net (Holesky) and use a signing wallet address dedicated for testing purposes only

This project provides a `compose.yaml` configuration which allows you to easily spin up the fee service.
A few steps are required to set this up. These steps are described below.

## Create a signing.key

The `fee` service requires a `signing.key` file. This file should provide the binary representation of a private key of the wallet to be used for signing purposes.

Example using xxd to create signing.key from private key:

```bash
echo <your private key> | xxd -r -p > signing.key
```

## Create a .env file

You can copy `.env-example` to `.env` and change the variables where needed.

## Run docker compose

This service requires the vrun-db local environment to be up and running as well. It will use the proxy network provided by the vrun-db compose file to provide `Traefik` access to the fee APIs.

### Start the service in the background
```bash
docker compose --profile dev up -d
```

### Follow logs
```bash
docker compose --profile dev logs -f
```

### Rebuild image after code changes

You can force a docker rebuild by running the following docker compose commands:

```bash
docker compose build fee
```
