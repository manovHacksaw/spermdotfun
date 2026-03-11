const { ethers } = require('ethers')

const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc'
const CHAINLINK_AVAX_USD = '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD'
const ABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]

async function main() {
    const provider = new ethers.JsonRpcProvider(FUJI_RPC)
    const contract = new ethers.Contract(CHAINLINK_AVAX_USD, ABI, provider)
    const [, , , updatedAt,] = await contract.latestRoundData()
    const roundData = await contract.latestRoundData()
    console.log('--- CHAINLINK AVAX/USD (FUJI) ---')
    console.log('Raw Answer:', roundData.answer.toString())
    console.log('Decimals: 8')
    console.log('Formatted Price: $' + (Number(roundData.answer) / 1e8).toFixed(2))
    console.log('Last Update:', new Date(Number(roundData.updatedAt) * 1000).toLocaleString())
}

main().catch(console.error)
