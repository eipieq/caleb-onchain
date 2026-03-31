require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    initia_testnet: {
      url: process.env.INITIA_RPC_URL || "https://rpc.testnet.initia.xyz",
      chainId: parseInt(process.env.INITIA_CHAIN_ID || "1337"),
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY.replace("0x", "")}`] : [],
    },
  },
};
