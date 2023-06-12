import {Cell, beginCell, Dictionary, Slice, DictionaryValue, toNano } from 'ton-core';
import {sign} from 'ton-crypto';
import { bigint2buff} from '../utils';

type ConfigDict = Dictionary<number, Cell>;

export type ValidatorDescription = {
	type: "simple" | "adnl",
	public_key:Buffer,
	weight:bigint,
	adnl?: bigint
};

export const parsePublicKey = (sc: Slice) => {
	const tag = sc.loadUint(32);
	if(tag != 0x8e81278a)
		throw(Error(`invalid public key tag:${tag}`));
	return sc.loadBuffer(32);
}

export const ValidatorDescriptionValue:DictionaryValue<ValidatorDescription> = {
	serialize: (src, builder) => {
		let typeTag: number;
		if(src.type == "simple") {
			typeTag = 0x53;
		}
		else if(src.type == "adnl") {
			typeTag = 0x73;
		}
		else {
			throw Error("Unknown validator type:" + src.type);
		}

		builder.storeUint(typeTag, 8)
					 .storeUint(0x8e81278a, 32)
					 .storeBuffer(src.public_key, 32)
					 .storeUint(src.weight, 64);
		if(typeTag == 0x73)
			builder.storeUint(src.adnl!, 256)
	},
	parse: (src) => {
		const tag = src.loadUint(8);
		if(tag == 0x53) {
			return {
				type: "simple",
				public_key: parsePublicKey(src),
				weight: src.loadUintBig(64)
			}
		}
		else if (tag == 0x73) {
			return {
				type: "adnl",
				public_key: parsePublicKey(src),
				weight: src.loadUintBig(64),
				adnl: src.loadUintBig(256)
			}
		}
		throw(Error(`Invalid validator description tag:${tag}!`));
	}
};

type ValidatorSetData = {
	total:number,
	main:number,
	list: ValidatorDescription[]
};

export type ValidatorSetSimple = ValidatorSetData & {type: "simple"};

export type ValidatorSetExtended = ValidatorSetData & {
	type: "ext",
	total_weight:bigint,
	utime_since:number,
	utime_unitl:number
};

export type ValidatorSet = ValidatorSetSimple | ValidatorSetExtended;

export type StakeConf      = ReturnType<typeof getStakeConf>;
export type ElectionsConf  = ReturnType<typeof getElectionsConf>;
export type ValidatorsConf = ReturnType<typeof getValidatorsConf>;

export const loadConfig = (config: Cell) => {
	return config.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
}

export const packElect = (elect_at:number,
													elect_close:number,
													min_stake:bigint,
													total_stake:bigint,
													members:Cell | null,
													failed:boolean,
													finished:boolean) => {
	return beginCell().storeUint(elect_at, 32)
										.storeUint(elect_close, 32)
										.storeCoins(min_stake)
										.storeCoins(total_stake)
										.storeMaybeRef(members)
										.storeBit(failed)
										.storeBit(finished)
				 .endCell();
}
export const getStakeConf = (config: Cell | ConfigDict) => {
	const confDict = config instanceof Cell ? loadConfig(config) : config;
	const sConf    = confDict.get(17);
	if(sConf === undefined)
		throw("Stake config has to be present");
	const cs = sConf.beginParse();

	return {
		min_stake: cs.loadCoins(),
		max_stake: cs.loadCoins(),
		min_total_stake: cs.loadCoins(),
		max_stake_factor: cs.loadUint(32)
	};
}

export const packStakeConf = (stakeConf : StakeConf) => {
	return beginCell().storeCoins(stakeConf.min_stake)
				  .storeCoins(stakeConf.max_stake)
				  .storeCoins(stakeConf.min_total_stake)
				  .storeUint(stakeConf.max_stake_factor, 32)
				.endCell();
}

export const packElectionsConf = (electConfig: ElectionsConf) => {
	return beginCell().storeInt(electConfig.elected_for, 32)
				 	.storeInt(electConfig.begin_before, 32)
				 	.storeInt(electConfig.end_before, 32)
				 	.storeInt(electConfig.stake_held_for, 32)
				 .endCell();
}

export const getElectionsConf = (config: Cell | ConfigDict) => {
	const confDict = config instanceof Cell ? loadConfig(config) : config;
	const vConf    = confDict.get(15);
	
	if(vConf === undefined)
		throw("Elections config has to be present!");

	const vs = vConf.beginParse();

	return {
		elected_for: vs.loadInt(32),
		begin_before: vs.loadInt(32),
		end_before: vs.loadInt(32),
		stake_held_for: vs.preloadInt(32)
	};
}

export const packValidatorsConf = (validatorsConf: ValidatorsConf) => {
	return beginCell()
					.storeUint(validatorsConf.max_validators, 16)
					.storeUint(validatorsConf.max_main, 16)
					.storeUint(validatorsConf.min_validators, 16)
				 .endCell();
}

export const getValidatorsConf  = (config: Cell | ConfigDict) => {
	const confDict = config instanceof Cell ? loadConfig(config) : config;
	const vConf    = confDict.get(16);

	if(vConf === undefined)
		throw("Validators config has to be present!");

	const vs = vConf.beginParse();

	return {
		max_validators: vs.loadUint(16),
		max_main: vs.loadUint(16),
		min_validators: vs.loadUint(16)
	}

}

export const signHash = (data: Cell | Buffer, priv:Buffer) => {
	const hash = data instanceof Cell ? data.hash() : data;
	return beginCell().storeBuffer(sign(hash, priv)).endCell();
}

const parseValidatorsSimple = (vs: Slice): ValidatorSetSimple => {
	return {
		type: "simple",
		total: vs.loadUint(16),
		main: vs.loadUint(16),
		list: vs.loadDict(Dictionary.Keys.Uint(16), ValidatorDescriptionValue).values()
	}
}

const parseValidatorsExt = (vs: Slice):ValidatorSetExtended => {
	return {
		type: "ext",
		utime_since: vs.loadUint(32),
		utime_unitl: vs.loadUint(32),
		total: vs.loadUint(16),
		main: vs.loadUint(16),
		total_weight: vs.loadUintBig(64),
		list: vs.loadDict(Dictionary.Keys.Uint(16), ValidatorDescriptionValue).values() //list.values()
	}
}
export const parseValidatorsSet = (vs: Slice):ValidatorSet => {
	const tag = vs.loadUint(8);
	if(tag == 0x12) {
		return parseValidatorsExt(vs);
	}
	else if(tag == 0x11) {
		return parseValidatorsSimple(vs);
	}
	else {
		throw(Error("Unknown validators set tag:" + tag));
	}
};

const packValidatorsList = (list:ValidatorDescription[]) => {
	const dict = Dictionary.empty(Dictionary.Keys.Uint(16), ValidatorDescriptionValue);
	for(let i = 0; i < list.length; i++) {
		dict.set(i, list[i]);
	}
	return dict;
}

const packExtVset = (vs: ValidatorSetExtended) => {
	return beginCell().storeUint(0x12, 8)
										.storeUint(vs.utime_since, 32)
										.storeUint(vs.utime_unitl, 32)
										.storeUint(vs.total, 16)
										.storeUint(vs.main, 16)
										.storeUint(vs.total_weight, 64)
										.storeDict(packValidatorsList(vs.list))
				 .endCell();
}

const packSimpleVset = (vs:ValidatorSetSimple) => {
	return beginCell().storeUint(0x11, 8)
										.storeUint(vs.total, 16)
										.storeUint(vs.main, 16)
										.storeDict(packValidatorsList(vs.list))
				 .endCell();
}


export const packValidatorsSet = (vs: ValidatorSet) => {
	const data = beginCell();
	if(vs.type == "ext") {
		return packExtVset(vs);
	}
	return packSimpleVset(vs);
}
export const getVset = (config: Cell | ConfigDict, idx: 34 | 36): ValidatorSetExtended => {
	const confDict = config instanceof Cell ? loadConfig(config) : config;
	const curVset  = confDict.get(idx);
	if(curVset === undefined)
		throw(Error(`No validators set preset at:${idx}!`))
	const vs   = curVset.beginParse();
	const vset = parseValidatorsSet(vs);

	if(vset.type !== "ext")
		throw(Error(`Extended validator set expected at idx:${idx}`))

	return vset;
}

export const signData = (data:Cell, priv:Buffer) => {
	// I know buffer aggregation is supposed to be recursive, but it's good enough for elector cases
	return beginCell().storeBuffer(sign(Buffer.from(data.bits.toString(), 'hex'), priv)).endCell();
}

export const calcMaxPunishment = (stake: bigint, config: Cell | ConfigDict) => {
	// https://github.com/ton-blockchain/ton/blob/master/lite-client/lite-client.cpp#L3733
	// Code taken from here.
	// All conditions removed to calculate worst case scenario fine.

	const confDict = config instanceof Cell ? loadConfig(config) : config;
	const punishmentConf = confDict.get(40);
	if(! punishmentConf)
		return toNano('101');

	const ps = punishmentConf.beginParse();
	if(ps.loadUint(8) != 1)
		throw Error("Incorrect prefix in punishment config");
	const flat_fine = ps.loadCoins();
	const proporitonal_fine = ps.loadUintBig(32);
	console.log(proporitonal_fine);
	const severity_flat_mult = ps.loadUintBig(16);
	const severity_prop_mult = ps.loadUintBig(16);
	ps.skip(32); // unpunishable_interval, long_interval
	const long_flat_mult = ps.loadUintBig(16);
	const long_prop_mult = ps.loadUintBig(16);
	let fine = flat_fine;
	let fine_part = proporitonal_fine;

	fine      = fine * severity_flat_mult; fine >>= 8n;
  fine_part = fine_part * severity_prop_mult; fine_part >>= 8n;

  fine = fine * long_flat_mult; fine >>= 8n;
  fine_part = fine_part * long_prop_mult; fine_part >>= 8n;
	/*
		That is lower than long_flat, so it's not calculated in worst case scenario
  fine = fine * medium_flat_mult; fine >>= 8;
  fine_part = fine_part * rec.medium_proportional_mult; fine_part >>= 8;
	*/
	fine = fine + (stake * fine_part / BigInt(1 << 32));
	// console.log(stake);
 	if(fine > stake) 
		return stake;

	return fine;
}
