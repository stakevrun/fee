import { ethers } from 'ethers'
import express from 'express'
import cors from 'cors'

const genesisTimes = {
  1: 1606824023,
  17000: 1695902400
}
const secondsPerSlot = 12
const slotsPerEpoch = 32

const rocketStorageABI = [
  'function getAddress(bytes32) view returns (address)'
]

const rocketNodeManagerABI = [
  'function getSmoothingPoolRegistrationState(address) view returns (bool)',
  'function getSmoothingPoolRegistrationChanged(address) view returns (uint256)'
]
const rocketNodeManagerKey = ethers.id('contract.addressrocketNodeManager')
const getRocketNodeManager = async (rocketStorage) =>
  new ethers.Contract(await rocketStorage['getAddress(bytes32)'](rocketNodeManagerKey),
    rocketNodeManagerABI, rocketStorage.runner)

const rocketNodeDistributorFactoryABI = [
  'function getProxyAddress(address) view returns (address)'
]
const rocketNodeDistributorFactoryKey = ethers.id('contract.addressrocketNodeDistributorFactory')
const getNodeDistributorAddress = (rocketStorage, nodeAddress) =>
  rocketStorage['getAddress(bytes32)'](rocketNodeDistributorFactoryKey).then(addr =>
    (new ethers.Contract(addr, rocketNodeDistributorFactoryABI, rocketStorage.runner)).getProxyAddress(nodeAddress)
  )

const rocketSmoothingPoolKey = ethers.id('contract.addressrocketSmoothingPool')
const getSmoothingPoolAddress = rocketStorage => rocketStorage['getAddress(bytes32)'](rocketSmoothingPoolKey)

const rocketStorageFactories = {
  1: new ethers.Contract('0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46', rocketStorageABI),
  17000: new ethers.Contract('0x594Fb75D3dc2DFa0150Ad03F99F97817747dd4E1', rocketStorageABI)
}

const timestamp = () => Intl.DateTimeFormat('en-GB',
    {year: 'numeric', month: 'short', day: '2-digit',
     hour: '2-digit', minute: '2-digit', second: '2-digit'}
  ).format(new Date())

const providers = {
  1: new ethers.JsonRpcProvider(process.env.RPC_MAINNET || 'http://localhost:8545'),
  17000: new ethers.JsonRpcProvider(process.env.RPC_HOLESKY || 'http://localhost:8546')
}

const beaconUrls = {
  1: process.env.BN_MAINNET || 'http://localhost:5052',
  17000: process.env.BN_HOLESKY || 'http://localhost:5053'
}

const port = process.env.PORT || 8080

const feeContractAddresses = {
  17000: {address: '0x272347F941fb5f35854D8f5DbDcEdef1A515dB41', deployBlockNumber: 1091372}
}

const newAcceptedTokens = () => ({ blockNumber: 0, includedLogs: new Set(), current: new Set(), ever: new Set() })
const newPayments = () => ({ blockNumber: 0, includedLogs: new Set(), paymentsByAddress: {} })

const acceptedTokensByChain = {
  1: newAcceptedTokens(),
  17000: newAcceptedTokens()
}

const paymentsByChain = {
  1: newPayments(),
  17000: newPayments()
}

const newUnfinalizedPayments = () => ({ blockNumber: 0, paymentsByBlock: new Map() })

const unfinalizedPaymentsByChain = {
  1: newUnfinalizedPayments(),
  17000: newUnfinalizedPayments()
}

const setEnabledLogsByChainAndAddress = {
  1: {},
  17000: {}
}

const beaconIntervalByChainAndPubkey = {
  1: {},
  17000: {}
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

const unfinalizedBlockNumberByChain = {
  // 1: 0,
  17000: 0
}

const finalizedSlotNumberByChain = {
  // 1: 0,
  17000: 0
}

const timestampToSlot = (chainId, timestamp) => {
  const genesisTime = genesisTimes[chainId]
  return Math.floor((timestamp - genesisTime) / secondsPerSlot)
}

const updateAcceptedTokens = async (chainId) => {
  const feeContract = feeContracts[chainId]
  if (!feeContract) return
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
  if (!feeContract) return

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

  const unfinalizedBlockNumber = unfinalizedBlockNumberByChain[chainId]
  const unfinalizedPaymentsForChain = unfinalizedPaymentsByChain[chainId]
  const unfinalizedPaymentsByBlock = unfinalizedPaymentsForChain.paymentsByBlock
  for (const blockNumber of unfinalizedPaymentsByBlock.keys())
    if (blockNumber <= finalizedBlockNumber)
      unfinalizedPaymentsByBlock.delete(blockNumber)
  if (unfinalizedPaymentsForChain.blockNumber <= finalizedBlockNumber)
    unfinalizedPaymentsForChain.blockNumber = finalizedBlockNumber + 1
  // TODO: refactor to avoid so much duplication with above
  while (unfinalizedPaymentsForChain.blockNumber < unfinalizedBlockNumber) {
    const min = unfinalizedPaymentsForChain.blockNumber
    const max = Math.min(min + MAX_QUERY_RANGE, unfinalizedBlockNumber)
    await feeContract.queryFilter('Pay', min, max).then(async logs => {
      console.log(`Got ${logs.length} unfinalized Pay logs between ${min} and ${max}`)
      for (const log of logs) {
        const {transactionHash, transactionIndex, args} = log
        const block = await log.getBlock()
        const blockNumber = block.number
        if (!unfinalizedPaymentsByBlock.has(blockNumber))
          unfinalizedPaymentsByBlock.set(blockNumber, { includedLogs: new Set(), paymentsByAddress: {} })
        const {includedLogs, paymentsByAddress} = unfinalizedPaymentsByBlock.get(blockNumber)
        const logId = `${transactionHash}:${transactionIndex}`
        console.log(`Processing unfinalized log ${logId}`)
        if (!includedLogs.has(logId)) {
          const address = args.user.toLowerCase()
          console.log(`Adding unfinalized log for ${address}`)
          includedLogs.add(logId)
          paymentsByAddress[address] ??= []
          paymentsByAddress[address].push({
            amount: args.amount.toString(),
            token: args.token,
            timestamp: block.timestamp,
            tx: transactionHash
          })
        }
      }
    })
    unfinalizedPaymentsForChain.blockNumber = max
    console.log(`${timestamp()}: ${chainId}: updated unfinalized payments to ${max}`)
  }
}

for (const [chainId, provider] of Object.entries(providers)) {
  provider.on('block', async (latestBlockNumber) => {
    unfinalizedBlockNumberByChain[chainId] = latestBlockNumber
    const block = await provider.getBlock('finalized')
    finalizedBlockNumberByChain[chainId] = block.number
    const slotNumber = timestampToSlot(chainId, block.timestamp)
    if (finalizedSlotNumberByChain[chainId] != slotNumber) {
      console.log(`${timestamp()}: ${chainId}: finalized slot: ${slotNumber}`)
      finalizedSlotNumberByChain[chainId] = slotNumber
    }
    await Promise.all([updateAcceptedTokens(chainId), updatePayments(chainId)])
  })
}

const app = express()

app.use(cors())

const addressRe = '0x[0-9a-fA-F]{40}'
const addressRegExp = new RegExp(addressRe)
const pubkeyRe = '0x[0-9a-fA-F]{96}'

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
      const payments = paymentsByChain[req.params.chainId].paymentsByAddress[address]?.slice()
      const result = {}
      tokens.forEach(t => result[t] = [])
      if (!payments) return res.status(404).json(result)
      unfinalizedPaymentsByChain[req.params.chainId].paymentsByBlock.forEach(
        ({paymentsByAddress}) => payments.push(...(paymentsByAddress[address] || []))
      )
      for (const log of payments) {
        if (tokens.includes(log.token))
          result[log.token].push({amount: log.amount, timestamp: log.timestamp, tx: log.tx})
      }
      return res.status(200).json(result)
    }
    catch (e) { next(e) }
  }
)

const padNum = (n, z) => n.toString().padStart(z, '0')
const formatDay = (d) => `${padNum(d.getUTCFullYear(), 4)}-${padNum(d.getUTCMonth()+1, 2)}-${padNum(d.getUTCDate(), 2)}`

app.get(`/:chainId(\\d+)/:address(${addressRe})/:pubkey(${pubkeyRe})/charges`,
  async (req, res, next) => {
    try {
      const chainId = req.params.chainId
      const beaconUrl = beaconUrls[chainId]
      if (!beaconUrl) return fail(res, 404, 'unknown chainId')
      const address = req.params.address.toLowerCase()
      const pubkey = req.params.pubkey.toLowerCase()
      // TODO: accept 'after' or similar query param for restricted date range
      const setEnabledLogsByAddress = setEnabledLogsByChainAndAddress[chainId]
      const beaconIntervalByPubkey = beaconIntervalByChainAndPubkey[chainId]
      if (!(setEnabledLogsByAddress && beaconIntervalByPubkey)) return fail(res, 404, 'no logs/intervals for chainId')
      beaconIntervalByPubkey[pubkey] ||= {slotNumber: 0}
      const beaconInterval = beaconIntervalByPubkey[pubkey]
      const finalizedSlotNumber = finalizedSlotNumberByChain[chainId]
      if (beaconInterval.slotNumber < finalizedSlotNumber) {
        const validatorStateURL = `${beaconUrl}/eth/v1/beacon/states/${finalizedSlotNumber}/validators/${pubkey}`
        const validatorStateRes = await fetch(validatorStateURL).catch(
          e => ({status: 500, text: () => `${validatorStateURL}: ${e.message}`}))
        if (validatorStateRes.status === 404)
          return res.status(200).json([]) // validator not found: assume no chargeable days yet
        if (validatorStateRes.status !== 200)
          return fail(res, validatorStateRes.status, `failed to fetch validator status: ${await validatorStateRes.text()}`)
        const validatorState = await validatorStateRes.json().then(j => j.data.validator)
        const genesisTime = genesisTimes[chainId]
        beaconInterval.activationTime = genesisTime + validatorState.activation_epoch * slotsPerEpoch * secondsPerSlot
        // TODO: check if there are duties during the exit epoch
        beaconInterval.exitTime = genesisTime + validatorState.exit_epoch * slotsPerEpoch * secondsPerSlot
        beaconInterval.slotNumber = finalizedSlotNumber
      }
      setEnabledLogsByAddress[address] ||= {}
      const setEnabledLogsByPubkey = setEnabledLogsByAddress[address]
      setEnabledLogsByPubkey[pubkey] ||= []
      const setEnabledLogs = setEnabledLogsByPubkey[pubkey]
      const setEnabledLogCount = await fetch(`https://api.vrün.com/${chainId}/${address}/${pubkey}/length?type=SetEnabled`).then(async r => {
        if (r.status !== 200)
          return fail(res, r.status, `failed to fetch logs length: ${await r.text()}`)
        else return r.json()
      }).catch(e => fail(res, 500, e.message))
      if (typeof setEnabledLogCount !== 'number')
        return res.headersSent || fail(res, 500, `failed to fetch logs length: ${setEnabledLogCount}`)
      if (setEnabledLogCount > setEnabledLogs.length) {
        const numMissing = setEnabledLogs.length - setEnabledLogCount
        const moreLogsRes = await fetch(`https://api.vrün.com/${chainId}/${address}/${pubkey}/logs?type=SetEnabled&start=${numMissing}`)
        if (moreLogsRes.status !== 200)
          return fail(res, moreLogsRes.status, `failed to fetch logs: ${await moreLogsRes.text()}`)
        const moreLogs = await moreLogsRes.json()
        setEnabledLogs.push(...moreLogs)
      }
      let lastEnabled = false
      let lastTimestamp = 0
      const activeIntervals = []
      const addInterval = timestamp => {
        const startTime = Math.max(lastTimestamp, beaconInterval.activationTime)
        const endTime = Math.min(timestamp, beaconInterval.exitTime)
        if (endTime < startTime) return
        const firstDayDate = new Date(startTime * 1000)
        const lastDayDate = new Date(endTime * 1000)
        const firstDay = formatDay(firstDayDate)
        const lastDay = formatDay(lastDayDate)
        const numDays = ((Date.parse(lastDay) / 1000) - (Date.parse(firstDay) / 1000)) / (24 * 60 * 60) + 1
        activeIntervals.push({startTime, firstDay, endTime, lastDay, numDays})
      }
      for (const {enabled, timestamp} of setEnabledLogs) {
        if (timestamp <= lastTimestamp) return fail(res, 500, `SetEnabled logs not in order for ${pubkey}`)
        if (enabled == lastEnabled) return fail(res, 500, `SetEnabled logs do not alternate for ${pubkey}`)
        if (lastEnabled) addInterval(timestamp)
        lastEnabled = enabled
        lastTimestamp = timestamp
      }
      if (lastEnabled) addInterval(Math.round(new Date().getTime() / 1000))
      // TODO: add query param to skip merging?
      const mergedIntervals = []
      for (const interval of activeIntervals) {
        if (mergedIntervals.at(-1)?.lastDay === interval.firstDay) {
          const prevInterval = mergedIntervals.at(-1)
          prevInterval.lastDay = interval.lastDay
          prevInterval.endTime = interval.endTime
          prevInterval.numDays += interval.numDays - 1
        }
        else
          mergedIntervals.push(interval)
      }
      return res.status(200).json(mergedIntervals)
    }
    catch (e) { next(e) }
  }
)

app.get(`/:chainId(\\d+)/:address(${addressRe})/rp-fee-recipient`,
  async (req, res, next) => {
    try {
      const chainId = req.params.chainId
      const beaconUrl = beaconUrls[chainId]
      const provider = providers[chainId]
      if (!(beaconUrl && provider)) return fail(res, 404, 'unknown chainId')
      const address = req.params.address.toLowerCase()
      const pubkey = req.params.pubkey.toLowerCase()
      const rocketStorage = rocketStorageFactories[chainId].connect(provider)
      const rocketNodeManager = await getRocketNodeManager(rocketStorage)
      const [inSmoothingPool, lastChange] = await Promise.all([
        rocketNodeManager.getSmoothingPoolRegistrationState(nodeAddress),
        rocketNodeManager.getSmoothingPoolRegistrationChanged(nodeAddress)
      ])
      // TODO: depend on lastChange and current epoch
      const rpFeeRecipient = inSmoothingPool ?
        await getSmoothingPoolAddress(rocketStorage) :
        await getNodeDistributorAddress(rocketStorage, address)
      return res.status(200).json(rpFeeRecipient)
    }
    catch (e) { next (e) }
  }
)

app.listen(port)
