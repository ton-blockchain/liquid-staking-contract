import { Address, beginCell, Cell, contractAddress, storeMessageRelaxed, toNano, fromNano, OpenedContract, Transaction } from "@ton/core";
import { NetworkProvider, sleep, compile, UIProvider } from "@ton/blueprint";
import { getLastBlock, promptAddress, promptAmountBigInt, promptAmount, promptBool, chooseBool } from "../wrappers/ui-utils";
import { Pool, PoolData } from "../wrappers/Pool";
import { Conf, Op } from '../PoolConstants';
import { poolFullConfigToCell } from "../wrappers/Pool";
import { dataToFullConfig } from "../wrappers/Pool";
import { TonClient4 } from "@ton/ton";
import { PoolFullConfig } from "../wrappers/Pool";
import { Blockchain, internal, RemoteBlockchainStorage, SandboxContract, wrapTonClient4ForRemote } from "@ton/sandbox";
import { findTransaction } from "../utils";
import { flattenTransaction } from "@ton/test-utils";
import { inspect } from "node-inspect-extracted";



type ModifiableSources = 'controller_code' | 'pool_jetton_wallet_code' | 'payout_minter_code';
// We might want to add some more fields here
type ModifiableFields  = 'totalBalance'| 'poolJetton'| 'poolJettonSupply'| 'requestedForDeposit'| 'requestedForWithdrawal'|'depositsOpen';


type SourceMap  = Map<ModifiableSources, {source: string, compiled: Cell}>;

const modifiableSources : Array<ModifiableSources> = ['controller_code' , 'pool_jetton_wallet_code' , 'payout_minter_code']
const modifiableFields : Array<ModifiableFields> = ['totalBalance', 'poolJetton', 'poolJettonSupply', 'requestedForDeposit', 'requestedForWithdrawal','depositsOpen']
let emulator : Blockchain;
let ui: UIProvider;
let api: TonClient4;
let poolCode: Cell;
let poolAddress: Address;
let multisigAddress: Address;
let sourceMap: SourceMap;
let poolContract: OpenedContract<Pool>;
let poolEmulated: SandboxContract<Pool>;

function curTime () {
    return Math.floor(Date.now() / 1000);
}

function txFailed<T extends Transaction>(txs: Array<T>, desc: string) {
    ui.write(`${desc} transaction failed during emulation phase!`);
    ui.write(inspect(txs.map(t => flattenTransaction(t))));
}

function isNotUpgraded<T extends Transaction>(field: string, txs: Array<T>, desc: string) {
    ui.write(`${field} is not updated!`);
    txFailed(txs, desc);
};

function estimateFees<T extends Transaction>(txs: Array<T>, min_fee?: bigint, from?:number){
    let txsInScope: Array<T>;

    if(from) {
        if(from >= txs.length) {
            throw new Error(`${from}index out of bounds ${txs.length - 1}!`);
        }

        txsInScope = txs.slice(from);
    }
    else {
        txsInScope = txs;
    }

    const totalFees = txsInScope.reduce((acc, cur) => acc + cur.totalFees.coins, 0n);
    const minRequired = totalFees + 1n;

    // console.log(txs[0].description);
    // console.log(`Total fees: ${fromNano(totalFees)}`);

    return min_fee ? (min_fee > minRequired ? min_fee : minRequired) : minRequired;
}

function tonStringify(k: string, value: any) {
    const special = typeof value == 'bigint' || value instanceof Address;

    return special ? value.toString() : value;
}

async function printBoc(desc: string, recepient: Address, value: bigint, boc: Cell) {
    ui.write(`${desc} \n\n`);
    ui.write(`Recepient: ${recepient}\n\n`);
    ui.write(`Value: ${fromNano(value)}\n\n`);
    ui.write(`Boc: ${boc.toBoc().toString('base64')}\n\n`);

    ui.write('Message order is strictly importat!')

    await ui.input('Press enter once message is added to order...');
}

function flatAction(input: string) {
    return input.replace(/ /g,'_').toLowerCase();
}

function camelCase (input: string) {
    const words = input.split(' ');
    for(let i = 0; i < words.length; i++) {
        if(i == 0) {
            words[i] = words[i].toLowerCase();
        }
        else {
            words[i] = words[i].replace(/[A-Za-z]/, (chr, idx) => chr.toUpperCase());
        }
    }

    return words.join('');
}

async function haltPool(halt: boolean, prevData?: PoolData) {

    prevData = prevData ?? await poolContract.getFullDataRaw();

    let haltCell : Cell;
    let placeholder: 'Halt' | 'Unhalt';
    let sendFrom: Address;

    const now = curTime();
    if(halt) {
        haltCell = Pool.haltMessage(now);
        placeholder = 'Halt';
        sendFrom = prevData.halter;
    }
    else {
        haltCell    = Pool.unhaltMessage(now);
        placeholder = 'Unhalt';
        sendFrom    = prevData.governor;
    }
    
    const res = await emulator.sendMessage(internal({
        from: sendFrom,
        to: poolAddress,
        body: haltCell,
        value: toNano('1')
    }));
    
    // Index is 0 because we don't have external tx
    const haltTx = flattenTransaction(res.transactions[0]);
    
    if(haltTx.success !== true || haltTx.actionResultCode !== 0) {
        txFailed(res.transactions, placeholder);
        return;
    }
    if((await poolEmulated.getFullDataRaw()).halted != halt) {
        ui.write(`Failed to ${placeholder.toLowerCase()} pool during emulation!`);
        txFailed(res.transactions, placeholder);
        return;
    }

    await printBoc(`${placeholder} boc`, poolAddress, estimateFees(res.transactions, toNano('0.05')), haltCell);
        
    if(halt) {
        ui.write('Halt is currenty recommended to be executed in separate order'); 
        // Or is it?
        // Should we do it all in a single order?
        await ui.input('Press enter once order is executed to continue upgrade...');
    }

    return;
}

async function upgradeContract(provider:NetworkProvider, prevData: PoolData) {
    let   updateCode = false;
    let   updateData : boolean;


    if(!prevData.halted) {
        ui.write('Pool is not halted!');
        ui.write('Upgrade is not possible on unhalted pool.');
        const haltNow = await promptBool('Do you want to halt it right away?', ['Y', 'N'], ui);

        if(haltNow) {
            await haltPool(true, prevData);
        }
        // Currently recommending to make halt separate order to be extra cautious
        return;
    }
    
    ui.write('Pool is halted and ready for migration');
    const poolState = await api.getAccountLite(await getLastBlock(provider), poolAddress);
    if(poolState.account.state.type !== "active")
        throw new Error("Pool account should be active");

    if(!Buffer.from(poolState.account.state.codeHash, 'base64').equals(poolCode.hash())) {
        // console.log(poolCode.hash());
        // console.log(Buffer.from(poolState.account.state.codeHash, 'base64'));
        ui.write('Code hash from pool.func differes from contract state code hash.');
        updateCode = await promptBool('Would you like to update pool code?', ['Y', 'N'], ui);
    }

    updateData = await promptBool('Would you like to update contract data?', ['Y','N'], ui);

    if(updateCode || updateData) {

        const newCode = updateCode ? poolCode : null;
        let newData : Cell | null;
        let dataUpdateResult : Awaited<ReturnType<typeof dataDialog>>;
        if(updateData) {
            dataUpdateResult = await dataDialog(prevData);
            newData    = dataUpdateResult.cell;
        }
        else {
            newData = null;
        }

        const upgradeBoc = Pool.upgradeMessage(newData, newCode, null, curTime());

        const res = await emulator.sendMessage(internal({
            from: prevData.governor,
            to: poolAddress,
            body: upgradeBoc,
            value: toNano('1')
        }));

        let upgradeTx = findTransaction(res.transactions, {
            from: prevData.governor,
            to: poolAddress
        });

        if(upgradeTx == undefined) {
            throw new Error("Upgrade emulation failed.\nNo upgrade transaction found!");
        }

        const flatTx = flattenTransaction(upgradeTx);

        if(flatTx.aborted || flatTx.actionResultCode !== 0) {
            txFailed(res.transactions, 'Upgrade');
        }

        const smc = await emulator.getContract(poolAddress);
        if(!smc.account.account)
          throw new Error("Account not found")
        if(smc.account.account.storage.state.type != "active" )
          throw new Error("Atempting to get data on inactive account");
        if(updateCode) {
            if(!smc.account.account.storage.state.state.code) {
                throw new Error("Emulation error: code is not present");
            }

            const contractCode = smc.account.account.storage.state.state.code;

            if(!smc.account.account.storage.state.state.code.hash().equals(newCode!.hash())){
                throw new Error("Emulation error: failed to upgrade code!");
            }
        }
        if(updateData) {
            if(!smc.account.account.storage.state.state.data)
              throw new Error("Emulation error: Data is not present");
            if(!smc.account.account.storage.state.state.data.hash().equals(newData!.hash())) {
                throw new Error("Emulation error: failed to update data");
            }

            const dataAfter = dataToFullConfig(await poolEmulated.getFullDataRaw());

            for (let source of modifiableSources) {
                if(dataUpdateResult!.updates[source]) {
                    const mapped = sourceMap.get(source)!;
                    if(! dataAfter[source].hash().equals(mapped.compiled.hash())) {
                        isNotUpgraded(source, res.transactions, 'Upgrade');
                        return;
                    }
                }
            }

            for (let field of modifiableFields) {
                const cmpData = dataUpdateResult!.updates[field];
                const contractData = dataAfter[field];

                if(cmpData) {
                    if(cmpData instanceof Address) {
                        if(!cmpData.equals(contractData as Address)) {
                            isNotUpgraded(field, res.transactions, 'Upgrade');
                            return;
                        }
                    }
                    else {
                        if(cmpData !== contractData) {
                            isNotUpgraded(field, res.transactions, 'Upgrade');
                            return;
                        }
                    }
                }
            }
        }
        ui.write("Upgrade emulation successful!\n\n");

        // Estimate transaction cost from wallet tx till end of chain with min fee of 0.05
        const feeEst = estimateFees(res.transactions, toNano('0.05'));

        await printBoc('Upgrade boc', poolAddress, feeEst, upgradeBoc); 

        const unhaltRn = await promptBool('Do you want to unhalt pool in one tx with upgrade?', ['Y', 'N'], ui);

        if(unhaltRn) {
            await haltPool(false, prevData);
        }
    }
    else {
        ui.write('Nothing to do then!');
    }
}

export async function run(provider: NetworkProvider) {
    ui     = provider.ui();
    api    = provider.api()

    let networkEndpoint: string;

    if(provider.network() == 'testnet') {
        networkEndpoint = 'https://testnet-v4.tonhubapi.com';
    }
    else {
        networkEndpoint = 'https://mainnet-v4.tonhubapi.com';
    }

    const client = new TonClient4({ endpoint: networkEndpoint});

    emulator = await Blockchain.create({
        storage: new RemoteBlockchainStorage(wrapTonClient4ForRemote(client))
    });


    poolCode = await compile('Pool');

    sourceMap = new Map ([
        ['controller_code', {source: 'controller.func', 
         compiled: await compile('Controller')}
        ],
        ['pool_jetton_wallet_code', {source: 'jetton-wallet.func',
        compiled: await compile('DAOJettonWallet')}],
        ['payout_minter_code', {source: 'payout_nft/nft-collection.func',
        compiled: await compile('PayoutNFTCollection')}]
    ]);


    const promptContractAddress =  async (prompt: string, fallback?: Address) => {
        let retry: boolean;
        let contractAddress: Address;

        do {
            retry = false;
            contractAddress     = await promptAddress(prompt, ui, fallback);
            const contractState = await api.getAccountLite(await getLastBlock(provider), contractAddress);
            if(contractState.account.state.type !== "active") {
                retry = true;
                ui.write("This contract is not active!\nPlease use another address, or deploy it first");
            }
        } while(retry);

        return contractAddress;
    };

    poolAddress = await promptContractAddress("Please specify pool address:");
    // multisigAddress = await promptContractAddress("Please specify multisig address:");

    poolContract = provider.open(Pool.createFromAddress(poolAddress));
    poolEmulated = emulator.openContract(Pool.createFromAddress(poolAddress));

    let   prevData : PoolData;
    let   action: string;

    do {
        prevData = await poolContract.getFullDataRaw();
        action   = flatAction(await ui.choose('Please pick action:', ['Halt pool', 
                                              'Migrate governance',
                                              'Upgrade contract',
                                              'Unhalt pool', 'Exit'], (c) => c ));
        switch(action) {
            case 'halt_pool':
                await haltPool(true, prevData);
                break;
            case 'migrate_governance':
                await migrateGovernance(prevData);
                break;
            case 'upgrade_contract':
                await upgradeContract(provider, prevData);
                break;
            case 'unhalt_pool':
                await haltPool(false, prevData);
                break;
            default:
        }
    } while(action !== 'exit');
    ui.write('Bye!');
    // console.log("Previous data:", prevData);
}

async function updateParam(config: PoolFullConfig, field: ModifiableFields, ui: UIProvider) : Promise<PoolFullConfig[ModifiableFields] | undefined> {
    let retVal: PoolFullConfig[ModifiableFields] | undefined = undefined;
    let updated : boolean;

    if(config[field] instanceof Address) {
        const newAddr = await promptAddress(`Provide new address for ${field}(${config[field]}):`, ui);
        if(!(config[field] as Address).equals(newAddr)) {
            (config[field] as Address) = newAddr;
            retVal = newAddr;
        }
    }
    else if(typeof config[field] == 'bigint') {
        const newVal = toNano(await promptAmount(`Please provide new ton/jetton value in decimal form for ${field}:`, ui));
        if((config[field] as bigint) != newVal) {
            ui.write('Got here!');
            (config[field] as bigint ) = newVal;
            retVal = newVal;
        }
    }
    else if(typeof config[field] == 'boolean') {
        const newVal = await chooseBool(`Set ${field} to:`, 'True', 'False', ui);
        if((config[field] as boolean) != newVal) {
            (config[field] as boolean) = newVal;
            retVal = newVal;
        }
    }
    return retVal;
}

async function prepareGovMigration() {
    let expIn : number;
    let retry : boolean;
    const prevData = await poolContract.getFullDataRaw();

    do {
        // Is quarrantine time + 5 minutes
        const minQuarantine = Conf.governorQuarantine + 300;
        // Could we do better than this?
        ui.write("Quorrantine expiration time should account for time it will take for you to send the boc.");
        expIn = await promptAmount('Please speccify number of secconds prior to governance upgrade.', ui, true, minQuarantine );

        if(expIn < Conf.governorQuarantine) {
            ui.write(`Value can't be lass than ${Conf.governorQuarantine}`);
            retry = true;
        }
        else {
            ui.write(`Governor address will be updatable in:${expIn} sec.`);
            retry = !(await promptBool('Is it ok?', ['Y', 'N'], ui));
        }
    } while(retry);


    const expUpdateIn = curTime() + expIn;
    const res = await poolEmulated.sendPrepareGovernanceMigration(emulator.sender(prevData.governor), expUpdateIn); 


    const prepTx = findTransaction(res.transactions, {
        from: prevData.governor,
        on: poolAddress,
        op: Op.governor.prepare_governance_migration,
        success: true,
    });

    if(!prepTx) {
        txFailed(res.transactions, 'Prepare governance migration');
    }
    else if((await poolEmulated.getFullDataRaw()).governorUpdateAfter != expUpdateIn) {
        ui.write('Governor update quorantine time has not changed during emulation!');
        txFailed(res.transactions, 'Prepare governance migration');
    }
    else {
        const boc = Pool.prepareGovernanceMigrationMessage(curTime() + expIn, curTime());
        await printBoc('Prepare governor migration boc', poolAddress, estimateFees(res.transactions, toNano('0.05')), boc);

        ui.write('Now you free to send the governor migration preparation order.');
        ui.write(`After ${expIn} secconsd you should be able to update governor`);
    }
}

async function updateRoles() {

    let isOk: boolean;
    let updates : {halter?: Address,
                   approver?: Address,
                   interestManager?: Address} = {};

    let curData = await poolContract.getFullDataRaw();

    do {
        let updateMore : boolean;
        do {
            const action = camelCase(await ui.choose('Pick role to update', ['Halter', 'Approver', 'Interest manager', 'Exit'], (c) => c));
            if(action == 'halter' || action == 'approver' || action == 'interestManager') {
                ui.write(`${action} current value:${curData[action]}`);
                updates[action] = await promptAddress(`Please provide new ${action} address:`, ui);
                updateMore      = await promptBool('Do you want to updat more roles?', ['Y','N'], ui);
            }
            else {
                updateMore = false;
            }
        } while(updateMore);
        ui.write('Following roles update is going to happen:');
        ui.write(JSON.stringify(updates, tonStringify, 2));
        isOk = await promptBool('It it ok?', ['Y', 'N'],ui);
    } while(! isOk);

    const updateBoc = Pool.setRolesMessage(null, updates.interestManager || null ,
                                           updates.halter || null, updates.approver || null);
    const res = await emulator.sendMessage(internal({
        from: curData.governor,
        to: poolAddress,
        body: updateBoc,
        value: toNano('1')
    }));

    const updRolesTx = findTransaction(res.transactions,{
        on: poolAddress,
        op: Op.governor.set_roles,
        success: true
    });

    if(!updRolesTx) {
        txFailed(res.transactions, 'Update roles');
        return;
    }

    const dataAfter = await poolEmulated.getFullDataRaw();

    for (let updField in updates) {
        // Typescript made me do dat!
        if(updField == 'halter' || updField == 'approver' || updField == 'interestManager') {
            if(!dataAfter[updField].equals(updates[updField] as Address)) {
                ui.write(`${updField} wasn't updated during emulation.`);
                txFailed(res.transactions, 'Update roles');
                return;
            }
        }
    }

    const fees = estimateFees(res.transactions, toNano('0.05'));

    await printBoc('Roles update boc', poolAddress, fees, updateBoc);

    ui.write('Now you may send roles update order!');
}

async function updateGovernor() {
    let proceed: boolean;
    let newGovernor: Address;

    const curData = await poolContract.getFullDataRaw();
    do {
        newGovernor = await promptAddress('Please specify new governor address:', ui);
        ui.write(`New governor:${newGovernor}`);
        proceed     = await promptBool("Are you absolutely sure that's the one? ",['Yes i am', 'N'], ui);
    } while(!proceed);

    const govSender = emulator.sender(curData.governor);
    /*
    if(curData.governorUpdateAfter !== 0xffffffffffff) {
        emulator.now = curData.governorUpdateAfter + 1; 
    }
    */
    const updateBoc = Pool.setRolesMessage(newGovernor, null, null, null);
    const res       = await emulator.sendMessage(internal({
        from: curData.governor,
        to: poolAddress,
        body: updateBoc,
        value: toNano('1')
    }));

    const dataAfter = await poolEmulated.getFullDataRaw();

    if(!dataAfter.governor.equals(newGovernor)) {
        txFailed(res.transactions, 'Governor update');
        return;
    }

    const fees = estimateFees(res.transactions, toNano('0.05'));
    await printBoc('Governor update', poolAddress, fees, updateBoc);
}
async function migrateGovernance(prevData?: PoolData) {

    if(!prevData) {
        prevData = await poolContract.getFullDataRaw();
    }

    const updateTime = prevData.governorUpdateAfter;
    const inProgress = updateTime !== 0xffffffffffff;
    let updateDelta = 0;

    let tooSoon: boolean;

    if(inProgress) {
        updateDelta = updateTime - curTime();
        tooSoon = updateDelta > 0;
    }
    else {
        tooSoon = true;
    }

    // tooSoon = false;
    const defActions = ['Prepare governance migration', 'Update roles'];
    const actions    = tooSoon ? [...defActions, 'Exit'] : [...defActions, 'Update governor', 'Exit'];
    const action     = flatAction(await ui.choose('Please pick action:', actions, (c) => c));

    switch(action) {
        case 'prepare_governance_migration':
            if(tooSoon) {
                ui.write("Governor migration already in progress!");
                ui.write(`You'll be able to update governor in ${updateDelta} secconds`);
                if(!(await promptBool('Do you still want to ovverride it?', ['Y', 'N'], ui))) {
                    break;
                }
            }
            await prepareGovMigration();
            break;
        case 'update_roles':
            await updateRoles();
        break;
        case 'update_governor':
            await updateGovernor();
        default:
    }
}

async function dataDialog(prev: PoolData) {

    const updatables: Array<ModifiableFields> = ['totalBalance', 'poolJetton', 'poolJettonSupply', 'requestedForDeposit', 'requestedForWithdrawal','depositsOpen'];


    
    let updateObject: {[Property in keyof PoolFullConfig]? : unknown} = {};
    let fullConfig: PoolFullConfig;
    let reDo: boolean;


    do {
        let updatedFields = new Set<ModifiableFields>();
        fullConfig = dataToFullConfig(prev);

        for( const [code_key, desc] of sourceMap ) {
            const updCode = fullConfig[code_key];

            if(!updCode.hash().equals(desc.compiled.hash())){
                ui.write(`Code hash from ${desc.source} differs from contract ${code_key}`);
                const doUpdate = await promptBool(`Would you like to update ${code_key} code?`, ['Y','N'], ui);
                if(doUpdate) {
                    fullConfig[code_key] = desc.compiled;
                    updateObject[code_key] = `updated from ${desc.source}`;
                }
            }
        }

        if(await promptBool('Do you want to modify any data fields?', ['Y', 'N'], ui)) {
            let updateMore: boolean;
            do {
                let pickPrompt = 'Pick data field to modify';
                let updArr     = [...updatedFields];

                if(updatedFields.size > 0) {
                    pickPrompt += `(${updArr.join(',')})` 
                }

                // Those fields are only updatable if payouts are deployed
                let picks = updatables.filter((x) => {
                    if(x == 'requestedForWithdrawal') {
                        if(prev.withdrawalPayout !== null) {
                            return x
                        }
                    }
                    else if(x == 'requestedForDeposit') {
                        if(prev.depositPayout !== null) {
                            return x;
                        }
                    }
                    else {
                        return x;
                    }
                });
                let param = await ui.choose(pickPrompt, picks, (c) => c);
                let res   = await updateParam(fullConfig, param, ui);

                if(res !== undefined) {
                    updatedFields.add(param);
                    updateObject[param] = res;
                    ui.write(`${param} updated\n`);
                }
                updateMore = await chooseBool('Would you like to update one more parameters?', 'Y','N', ui);
            } while (updateMore);
        }
        
        ui.write('Please overview data modifications carefully:')
        ui.write(JSON.stringify(updateObject, tonStringify, 2));
        reDo = !(await promptBool('Is everything OK?', ['Y','N'], ui));
    } while(reDo);

    return {cell: poolFullConfigToCell(fullConfig), updates: updateObject};
}
