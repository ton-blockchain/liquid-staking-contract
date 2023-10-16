import { SandboxContractProvider, TickOrTock } from "@ton/sandbox";
import { buff2bigint } from "../utils";
import { Config } from "./Config";
import { Address, Cell, ContractProvider, beginCell } from "@ton/core";
export class ConfigTest extends Config {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell, special:{tick:boolean, tock:boolean} }) {
    super(address, init);
  }

	static createFromAddress(address: Address) {
		return new ConfigTest(address);
	}

  static configState(config: Cell, public_key?: Buffer) {
    const pubKey = public_key ? buff2bigint(public_key) : 0n;
    return beginCell().storeRef(config).storeUint(0, 32).storeUint(pubKey, 256).storeDict(null).endCell()
  }

  async sendTickTock(provider: SandboxContractProvider, which: TickOrTock) {
    return await provider.tickTock(which);
  }


}
