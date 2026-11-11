import { type Address, type Hex, concatHex, encodeAbiParameters, getContractAddress } from "viem";
import { demoUsdcBytecode, pooledFundingBytecode } from "../generated/contracts";
import { CREATE2_DEPLOYER, DEPLOY_SALT } from "./constants";

// CREATE2 fixes each address from the deployer proxy, the salt and the exact creation code. Whoever
// sends the deployment, the contract at this address can only be the bytecode committed in this repo.
export const USDC_INIT_CODE: Hex = demoUsdcBytecode;

export const USDC_ADDRESS: Address = getContractAddress({
  opcode: "CREATE2",
  from: CREATE2_DEPLOYER,
  salt: DEPLOY_SALT,
  bytecode: USDC_INIT_CODE,
});

export const POOLS_INIT_CODE: Hex = concatHex([pooledFundingBytecode, encodeAbiParameters([{ type: "address" }], [USDC_ADDRESS])]);

export const POOLS_ADDRESS: Address = getContractAddress({
  opcode: "CREATE2",
  from: CREATE2_DEPLOYER,
  salt: DEPLOY_SALT,
  bytecode: POOLS_INIT_CODE,
});

// The proxy takes the salt followed by the creation code as calldata.
export const deployCalldata = (initCode: Hex): Hex => concatHex([DEPLOY_SALT, initCode]);
