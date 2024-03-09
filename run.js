import { ethers } from 'ethers'
import express from 'express'

const provider = new ethers.JsonRpcProvider(process.env.RPC || 'http://localhost:8545')

const port = process.env.PORT || 8080

const feeContractAddresses = {
  17000: {address: '0x272347F941fb5f35854D8f5DbDcEdef1A515dB41', deployBlockNumber: 1091372}
}

const acceptedTokensByChain = {
  17000: { blockNumber: 0, includedLogs: new Set(), current: new Set(), ever: new Set() }
}

const paymentsByChain = {
  17000: { blockNumber: 0, includedLogs: new Set(), paymentsByAddress: new Map() }
}

const feeContracts = {}

const feeContractAbi = [
  'function weth() view returns (address)',
  'function acceptedTokens(address) view returns (bool)',
  'event Pay(address indexed user, address indexed token, uint256 indexed amount)',
  'event SetToken(address indexed token, bool indexed accepted)'
]

const MAX_QUERY_RANGE = 10000

const finalizedBlockNumber = await provider.getBlock('finalized').then(b => b.number)

for (const [chainId, {address, deployBlockNumber}] of Object.entries(feeContractAddresses)) {
  const feeContract = new ethers.Contract(address, feeContractAbi, provider)
  feeContracts[chainId] = feeContract
  const acceptedTokens = acceptedTokensByChain[chainId]
  acceptedTokens.current.add(await feeContract.weth())
  acceptedTokens.ever.add(await feeContract.weth())
  acceptedTokens.blockNumber = deployBlockNumber
  while (acceptedTokens.blockNumber < finalizedBlockNumber) {
    const min = acceptedTokens.blockNumber
    const max = Math.min(min + MAX_QUERY_RANGE, finalizedBlockNumber)
    await feeContract.queryFilter('SetToken', min, max).then(logs => {
      for (const {transactionHash, transactionIndex, args} of logs) {
        const logId = `${transactionHash}:${transactionIndex}`
        if (!acceptedTokens.includedLogs.has(logId)) {
          acceptedTokens.includedLogs.add(logId)
          acceptedTokens.current[args.accepted ? 'add' : 'delete'](args.token)
          if (args.accepted) acceptedTokens.ever.add(args.token)
        }
      }
    })
    acceptedTokens.blockNumber = max
  }
  // TODO: add listener for SetToken
  const paymentsForChain = paymentsByChain[chainId]
  paymentsForChain.blockNumber = deployBlockNumber
  while (paymentsForChain.blockNumber < finalizedBlockNumber) {
    const min = paymentsForChain.blockNumber
    const max = Math.min(min + MAX_QUERY_RANGE, finalizedBlockNumber)
    await feeContract.queryFilter('Pay', min, max).then(logs => {
      for (const {transactionHash, transactionIndex, getBlock, args} of logs) {
        const logId = `${transactionHash}:${transactionIndex}`
        if (!paymentsForChain.includedLogs.has(logId)) {
          paymentsForChain.includedLogs.add(logId)
          paymentsForChain.paymentsByAddress[args.user] ??= []
          const timestamp = await getBlock().then(b => b.timestamp)
          paymentsForChain.paymentsByAddress[args.user].push({
            amount: args.amount,
            token: args.token,
            timestamp,
            tx: transactionHash
          })
        }
      }
    })
  }
  // TODO: add listener for Pay
}

// TODO: fill paymentsByChain and add listener

const app = express()

const addressRe = '0x[0-9a-fA-F]{40}'
const addressRegExp = new RegExp(addressRe)

const fail = (res, statusCode, body) => {
  res.status(statusCode).send(body)
}

app.get(`/:chainId(\\d+)/:address(${addressRe})/payments`,
  async (req, res, next) => {
    try {
      const feeContract = feeContracts[req.params.chainId]
      if (!feeContract) return fail(404, 'unknown chainId')
      const tokens = (typeof req.query.token == 'string' ? [req.query.token] : req.query.token) || []
      if (tokens.some(t => !addressRegExp.test(t)))
        return fail(400, 'invalid fee token address')
      // TODO: add 'after' query parameter for restricting time range
      const acceptedTokens = acceptedTokensByChain[req.params.chainId]
      if (tokens.some(t => !acceptedTokens.ever.has(t)))
        return fail(400, 'fee token was never accepted')
      if (!tokens.length)
        tokens = Array.from(acceptedTokens.current.values())
      const payments = paymentsByChain[req.params.chainId].paymentsByAddress[req.params.address]
      const result = {}
      tokens.forEach(t => result[t] = [])
      if (!payments) return res.status(404).json(result)
      for (const log of payments) {
        if (tokens.includes(log.token))
          result[log.token].append({amount: log.amount, timestamp: log.timestamp, tx: log.tx})
      }
      return res.status(200).json(result)
    }
    catch (e) { next(e) }
})

app.listen(port)
