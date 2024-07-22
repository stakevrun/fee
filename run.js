import { ethers } from 'ethers'
import express from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'

const signer = new ethers.Wallet(readFileSync('signing.key'))
console.log(`Using signer account ${await signer.getAddress()}`)

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

const feeReceivers = {
  1: '0x99E2b1FB1085C392b9091A5505b0Ac27979501F8',
  17000: '0x99E2b1FB1085C392b9091A5505b0Ac27979501F8',
}

const setEnabledLogsByChainAndAddress = {
  1: {},
  17000: {}
}

const beaconIntervalByChainAndPubkey = {
  1: {},
  17000: {}
}

const finalizedSlotNumberByChain = {
  1: 0,
  17000: 0
}

for (const [chainId, provider] of Object.entries(providers)) {
  provider.on('block', async (latestBlockNumber) => {
    const block = await provider.getBlock('finalized')
    const slotNumber = timestampToSlot(chainId, block.timestamp)
    if (finalizedSlotNumberByChain[chainId] != slotNumber) {
      console.log(`${timestamp()}: ${chainId}: finalized slot: ${slotNumber}`)
      finalizedSlotNumberByChain[chainId] = slotNumber
    }
  })
}

const timestampToSlot = (chainId, timestamp) => {
  const genesisTime = genesisTimes[chainId]
  return Math.floor((timestamp - genesisTime) / secondsPerSlot)
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
      const chainId = req.params.chainId
      // TODO: rework README, maybe rename route to balance?
      // cache and
      // return current credit balance of vrün validator days
      // based on reading the credit logs from the api
      /*
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
      */
      // if (!payments) return res.status(404).json(result)
      return res.status(501).end()
      /*
      unfinalizedPaymentsByChain[req.params.chainId].paymentsByBlock.forEach(
        ({paymentsByAddress}) => payments.push(...(paymentsByAddress[address] || []))
      )
      for (const log of payments) {
        if (tokens.includes(log.token))
          result[log.token].push({amount: log.amount, timestamp: log.timestamp, tx: log.tx})
      }
      return res.status(200).json(result)
      */
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
      const nodeAddress = req.params.address.toLowerCase()
      const rocketStorage = rocketStorageFactories[chainId].connect(provider)
      const rocketNodeManager = await getRocketNodeManager(rocketStorage)
      const [inSmoothingPool, lastChange] = await Promise.all([
        rocketNodeManager.getSmoothingPoolRegistrationState(nodeAddress),
        rocketNodeManager.getSmoothingPoolRegistrationChanged(nodeAddress)
      ])
      // TODO: depend on lastChange and current epoch
      const rpFeeRecipient = inSmoothingPool ?
        await getSmoothingPoolAddress(rocketStorage) :
        await getNodeDistributorAddress(rocketStorage, nodeAddress)
      return res.status(200).json(rpFeeRecipient)
    }
    catch (e) { next (e) }
  }
)

app.listen(port)
