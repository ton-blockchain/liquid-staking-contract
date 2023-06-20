import { Address, Cell, Contract} from "ton-core";

export class Config implements Contract {
	constructor(readonly address: Address,readonly init?: { code: Cell; data: Cell}){}

	static createFromAddress(address: Address) {
		return new Config(address);
	}
}
