import { ethers } from 'ethers'
import express from 'express'
import cors from 'cors'

const timestamp = () => Intl.DateTimeFormat('en-GB',
    {year: 'numeric', month: 'short', day: '2-digit',
     hour: '2-digit', minute: '2-digit', second: '2-digit'}
  ).format(new Date())

const providers = {
  // 1: new ethers.JsonRpcProvider(process.env.RPC || 'http://localhost:8545'),
  17000: new ethers.JsonRpcProvider(process.env.RPC_HOLESKY || 'http://localhost:8546')
}

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

for (const [chainId, {address, deployBlockNumber}] of Object.entries(feeContractAddresses)) {
  const provider = providers[chainId]
  const feeContract = new ethers.Contract(address, feeContractAbi, provider)
  feeContracts[chainId] = feeContract
  const acceptedTokens = acceptedTokensByChain[chainId]
  acceptedTokens.current.add(await feeContract.weth())
  acceptedTokens.ever.add(await feeContract.weth())
  acceptedTokens.blockNumber = deployBlockNumber
  const paymentsForChain = paymentsByChain[chainId]
  paymentsForChain.blockNumber = deployBlockNumber
}

const finalizedBlockNumberByChain = {
  // 1: 0,
  17000: 0
}

const updateAcceptedTokens = async (chainId) => {
  const feeContract = feeContracts[chainId]
  const finalizedBlockNumber = finalizedBlockNumberByChain[chainId]
  const acceptedTokens = acceptedTokensByChain[chainId]
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
    console.log(`${timestamp()}: ${chainId}: updated acceptedTokens to ${max}`)
  }
}

const updatePayments = async (chainId) => {
  const feeContract = feeContracts[chainId]
  const finalizedBlockNumber = finalizedBlockNumberByChain[chainId]
  const acceptedTokens = acceptedTokensByChain[chainId]
  const paymentsForChain = paymentsByChain[chainId]
  while (paymentsForChain.blockNumber < finalizedBlockNumber) {
    const min = paymentsForChain.blockNumber
    const max = Math.min(min + MAX_QUERY_RANGE, finalizedBlockNumber)
    await feeContract.queryFilter('Pay', min, max).then(async logs => {
      console.log(`Got ${logs.length} Pay logs between ${min} and ${max}`)
      for (const log of logs) {
        const {transactionHash, transactionIndex, args} = log
        const logId = `${transactionHash}:${transactionIndex}`
        console.log(`Processing log ${logId}`)
        if (!paymentsForChain.includedLogs.has(logId)) {
          const address = args.user.toLowerCase()
          console.log(`Adding log for ${address}`)
          paymentsForChain.includedLogs.add(logId)
          paymentsForChain.paymentsByAddress[address] ??= []
          const timestamp = await log.getBlock().then(b => b.timestamp)
          paymentsForChain.paymentsByAddress[address].push({
            amount: args.amount.toString(),
            token: args.token,
            timestamp,
            tx: transactionHash
          })
        }
      }
    })
    paymentsForChain.blockNumber = max
    console.log(`${timestamp()}: ${chainId}: updated payments to ${max}`)
  }
}

for (const [chainId, provider] of Object.entries(providers)) {
  provider.on('block', async () => {
    finalizedBlockNumberByChain[chainId] = await provider.getBlock('finalized').then(b => b.number)
    await Promise.all([updateAcceptedTokens(chainId), updatePayments(chainId)])
  })
}

const app = express()

app.use(cors())

const addressRe = '0x[0-9a-fA-F]{40}'
const addressRegExp = new RegExp(addressRe)

const fail = (res, statusCode, body) => {
  res.status(statusCode).send(body)
}

app.get(`/:chainId(\\d+)/:address(${addressRe})/payments`,
  async (req, res, next) => {
    try {
      const address = req.params.address.toLowerCase()
      const feeContract = feeContracts[req.params.chainId]
      if (!feeContract) return fail(res, 404, 'unknown chainId')
      let tokens = (typeof req.query.token == 'string' ? [req.query.token] : req.query.token) || []
      if (tokens.some(t => !addressRegExp.test(t)))
        return fail(res, 400, 'invalid fee token address')
      // TODO: add 'after' query parameter for restricting time range
      const acceptedTokens = acceptedTokensByChain[req.params.chainId]
      if (tokens.some(t => !acceptedTokens.ever.has(t)))
        return fail(res, 400, 'fee token was never accepted')
      if (!tokens.length)
        tokens = Array.from(acceptedTokens.current.values())
      const payments = paymentsByChain[req.params.chainId].paymentsByAddress[address]
      const result = {}
      tokens.forEach(t => result[t] = [])
      if (!payments) return res.status(404).json(result)
      for (const log of payments) {
        if (tokens.includes(log.token))
          result[log.token].push({amount: log.amount, timestamp: log.timestamp, tx: log.tx})
      }
      return res.status(200).json(result)
    }
    catch (e) { next(e) }
})

// TODO: add route for charges

app.listen(port)
