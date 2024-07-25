import { ethers } from 'ethers'
import express from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'

const signer = new ethers.Wallet(readFileSync('signing.key').toString('hex'))
console.log(`Using signer account ${await signer.getAddress()}`)

const nullAddress = '0x'.padEnd(42, '0')

const pricesUntilTimestamp = {
  'now': {
    // Ethereum
    1: {
      // Ethereum
      1: {
        '0x0000000000000000000000000000000000000000': '50000000000000',     // ETH
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': '50000000000000',     // WETH
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': '300000',             // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7': '300000',             // USDT
        '0x6B175474E89094C44Da98b954EedeAC495271d0F': '300000000000000000', // DAI
        '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0': '300000000000000000', // LUSD
      },
      // Arbitrum One
      42161: {
        '0x0000000000000000000000000000000000000000': '50000000000000',     // ETH
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': '50000000000000',     // WETH
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': '300000',             // USDC
      },
      // TODO: deploy Safe and add Base
      // TODO: deplay Safe and add Optimism
    },
    // Holesky
    17000: {
      // Holesky
      17000: {
        '0x0000000000000000000000000000000000000000': '50000000000000', // ETH
        '0x94373a4919B3240D86eA41593D5eBa789FEF3848': '50000000000000', // WETH
      },
      // Sepolia
      11155111: {
        '0x0000000000000000000000000000000000000000': '50000000000000', // ETH
        '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9': '50000000000000', // WETH
        '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '300000',         // USDC
      },
    },
  }
}

const sortedPricesTimestamps = Object.keys(pricesUntilTimestamp).map(k => k === 'now' ? Infinity : parseInt(k)).sort((a, b) => a - b)
const getPriceTimestamp = t => {
  const firstIncluding = sortedPricesTimestamps.find(k => t <= k)
  return firstIncluding === Infinity ? 'now' : firstIncluding
}

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
     42161: '0x99E2b1FB1085C392b9091A5505b0Ac27979501F8',
     17000: '0x99E2b1FB1085C392b9091A5505b0Ac27979501F8',
  11155111: '0x99E2b1FB1085C392b9091A5505b0Ac27979501F8',
}

const setEnabledLogsByChainAndAddress = {
  1: {},
  17000: {}
}

const creditAccountLogsByChainAndAddress = {
  1: {},
  17000: {}
}

const balanceByChainAndAddress = {
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

app.use(express.json())

const addressRe = '0x[0-9a-fA-F]{40}'
const addressRegExp = new RegExp(addressRe)
const pubkeyRe = '0x[0-9a-fA-F]{96}'

const fail = (res, statusCode, body) => {
  res.status(statusCode).send(body)
}

app.get(`/:chainId(\\d+)/prices`,
  async (req, res, next) => {
    try {
      const chainId = parseInt(req.params.chainId)
      const timestamp = parseInt(req.query.timestamp)
      const validUntil = Number.isNaN(timestamp) ? 'now' : getPriceTimestamp(timestamp)
      const pricesByChain = pricesUntilTimestamp[validUntil]
      const pricesPerDay = pricesByChain[chainId]
      if (!pricesPerDay) return fail(res, 404, 'Unknown chainId')
      return res.status(200).json({chainId, validUntil, pricesPerDay})
    }
    catch (e) { next(e) }
  }
)

const eip712DomainForChain = chainId => ({name: 'vrün', version: '1', chainId})
const eip712Types = {
  Pay: [
    {name: 'nodeAccount',     type: 'address'},
    {name: 'numDays',         type: 'uint256'},
    {name: 'tokenChainId',    type: 'uint256'},
    {name: 'tokenAddress',    type: 'address'},
    {name: 'transactionHash', type: 'bytes32'},
  ]
}

const transferInterface = new ethers.Interface(
  ['event Transfer(address indexed _from, address indexed _to, uint256 _value)']
)

app.put(`/:chainId(\\d+)/:address(${addressRe})/pay`,
  async (req, res, next) => {
    try {
      const chainId = req.params.chainId
      const provider = providers[chainId]
      if (!provider) return fail(res, 404, 'unknown chainId')
      const domain = eip712DomainForChain(chainId)
      const {signature, ...data} = req.body
      let signingAddress
      try {
        signingAddress = ethers.verifyTypedData(domain, eip712Types, data, signature)
      }
      catch (e) {
        return fail(res, 400, `could not verify signed data: ${e.message}`)
      }
      const txChainId = data.chainId
      const txProvider = providers[txChainId]
      const feeReceiver = feeReceivers[txChainId]
      if (!(txProvider && feeReceiver)) return fail(res, 400, 'unknown chainId for transaction')
      const tx = await txProvider.getTransaction(data.transactionHash)
      if (!tx) return fail(res, 400, 'transaction not found')
      if (signingAddress !== tx.from) return fail(res, 400, 'signature not by transaction sender')
      if (tx.to !== data.tokenAddress && !(tx.to === feeReceiver && data.tokenAddress === nullAddress))
        return fail(res, 400, 'not a payment transaction')
      const getTransferValue = async () => {
        const receipt = await tx.wait()
        const transferLogs = receipt.logs.map(log =>
          transferInterface.parseLog(log)
        ).filter(log => log && log.args._to === feeReceiver)
        return transferLogs.reduce((total, log) => total + log.args._value, 0n)
      }
      const transferValue = tx.to === feeReceiver ? tx.value : await getTransferValue()
      if (transferValue == 0) return fail(res, 400, 'no non-zero transfer to feeReceiver in transaction')
      const timestamp = await tx.getBlock().then(b => b.timestamp)
      const pricesByChain = pricesUntilTimestamp[getPriceTimestamp(timestamp)]
      if (!pricesByChain) return fail(res, 500, `failed to find prices at block timestamp ${timestamp}`)
      const pricesByTokenChainId = pricesByChain[chainId]
      if (!pricesByTokenChainId) return fail(res, 400, `no prices for chainId ${chainId}`)
      const prices = pricesByTokenChainId[tokenChainId]
      if (!prices) return fail(res, 400, `no prices for token chain ${tokenChainId} for chain ${chainId}`)
      const price = prices[ethers.getAddress(data.tokenAddress.toLowerCase())]
      if (!price) return fail(res, 400, `no price for token ${data.tokenAddress}`)
      if (BigInt(price) * BigInt(data.numDays) !== transferValue)
        return fail(res, 400, `numDays inconsistent with transfer value and price`)
      // TODO: check credit log for this transaction does not already exist
      // TODO: submit credit log for this transaction to api
      return res.status(501).end()
    }
    catch (e) { next(e) }
  }
)

app.get(`/:chainId(\\d+)/:address(${addressRe})/credits`,
  async (req, res, next) => {
    try {
      const address = req.params.address.toLowerCase()
      const chainId = req.params.chainId
      // TODO: add query parameters for restricting time range?
      const creditAccountLogsByAddress = creditAccountLogsByChainAndAddress[chainId]
      const balanceByAddress = balanceByChainAndAddress[chainId]
      if (!(creditAccountLogsByAddress && balanceByAddress)) return fail(res, 404, 'Unknown chainId')
      creditAccountLogsByAddress[address] ||= []
      balanceByAddress[address] ||= {length: 0, numDays: 0}
      const creditAccountLogs = creditAccountLogsByAddress[address]
      const balance = balanceByAddress[address]
      const creditAccountLogCount = await fetch(`https://api.vrün.com/${chainId}/${address}/credit/length`).then(async r => {
        if (r.status !== 200)
          return fail(res, r.status, `failed to fetch credit logs length: ${await r.text()}`)
        else return r.json()
      }).catch(e => fail(res, 500, e.message))
      if (typeof creditAccountLogCount !== 'number')
        return res.headersSent || fail(res, 500, `failed to fetch credit logs length: ${creditAccountLogCount}`)
      if (creditAccountLogCount > creditAccountLogs.length) {
        const numMissing = creditAccountLogs.length - creditAccountLogCount
        const moreLogsRes = await fetch(`https://api.vrün.com/${chainId}/${address}/credit/logs?start=${numMissing}`)
        if (moreLogsRes.status !== 200)
          return fail(res, moreLogsRes.status, `failed to fetch credit logs: ${await moreLogsRes.text()}`)
        const moreLogs = await moreLogsRes.json()
        creditAccountLogs.push(...moreLogs)
      }
      if (balance.length < creditAccountLogs.length) {
        for (const {numDays, decreaseBalance} of creditAccountLogs.slice(balance.length))
          balance.numDays += (decreaseBalance ? -1 : +1) * parseInt(numDays)
        balance.length = creditAccountLogs.length
      }
      return res.status(200).json(req.query.logs ? creditAccountLogs : balance.numDays)
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
