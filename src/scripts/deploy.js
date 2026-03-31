import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const artifact = JSON.parse(
  readFileSync(join(__dirname, "../../artifacts/contracts/DecisionLog.sol/DecisionLog.json"), "utf8")
);

const provider = new ethers.JsonRpcProvider(process.env.INITIA_RPC_URL);
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

console.log("deploying DecisionLog to", process.env.INITIA_RPC_URL);
console.log("deployer:", wallet.address);

const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy();

console.log("waiting for deployment tx...", contract.deploymentTransaction().hash);
await contract.waitForDeployment();

const address = await contract.getAddress();
console.log("\nDecisionLog deployed to:", address);
console.log("\nadd this to your .env:");
console.log(`DECISION_LOG_ADDRESS=${address}`);
