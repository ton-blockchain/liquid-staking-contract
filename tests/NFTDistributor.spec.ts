import { Blockchain, SandboxContract, TreasuryContract, BlockchainSnapshot, printTransactionFees, internal } from '@ton-community/sandbox';
import { Address, Cell, toNano, Dictionary, beginCell } from 'ton-core';
import { PayoutCollection, Errors, Op } from '../wrappers/PayoutNFTCollection';
import { PayoutItem } from '../wrappers/PayoutNFTItem';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { randomAddress } from '@ton-community/test-utils';
import { getRandomInt, getRandomTon } from '../utils'

describe('Distributor NFT Collection', () => {
    let collectionCode: Cell;
    let itemCode: Cell;
    let snapshots: Map<string, BlockchainSnapshot>
    let loadSnapshot: (snap: string) => Promise<void>;
    let collection: SandboxContract<PayoutCollection>
    let deployer: SandboxContract<TreasuryContract>;
    let notDeployer: SandboxContract<TreasuryContract>;
    let blockchain: Blockchain;
    let totalBill: bigint;
    let shares: Map<Address, bigint>;

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury("notDeployer");
        collectionCode = await compile('PayoutNFTCollection');
        itemCode = await compile('PayoutNFTItem');
        let config = {
            admin: deployer.address,
            content: Cell.EMPTY
        }
        collection = blockchain.openContract(PayoutCollection.createFromConfig(config, collectionCode));
        loadSnapshot = async (name: string) => {
          const shot = snapshots.get(name);
          if(!shot)
            throw(Error(`Can't find snapshot ${name}\nCheck tests execution order`));
          await blockchain.loadFrom(shot);
        }
    });

    describe("Distributing TONs", () => {
        const initDistribution = {
            active: false,
            isJetton: false,
            volume: 0n
        }
        beforeAll(async () => {
            snapshots = new Map<string, BlockchainSnapshot>();
            shares = new Map<Address, bigint>();
            totalBill = 0n;
            for (let addr of [deployer.address, notDeployer.address, randomAddress()]) {
                const share = getRandomTon(1, 100);
                totalBill += share;
                shares.set(addr, share);
            }
        });
        it('should not deploy (init) not from admin', async () => {
            const deployResult = await collection.sendDeploy(notDeployer.getSender(), initDistribution, toNano("0.5"));
            expect(deployResult.transactions).toHaveTransaction({
                to: collection.address,
                success: false,
                exitCode: Errors.unauthorized_init
            });
            snapshots.set("uninitialized", blockchain.snapshot());
        });
        it("should deploy collection with ton distribution", async () => {
            await loadSnapshot("uninitialized");
            const deployResult = await collection.sendDeploy(deployer.getSender(), initDistribution, toNano("1"));
            expect(deployResult.transactions).toHaveTransaction({
                to: collection.address,
                success: true,
                endStatus: 'active'
            });
            snapshots.set("initialized", blockchain.snapshot());
        });
        it("should mint NFT", async () => {
            await loadSnapshot("initialized");
            const dataBefore = await collection.getCollectionData();
            let index = dataBefore.nextItemIndex;
            for (let [addr, share] of shares) {
                const mintResult = await collection.sendMint(deployer.getSender(), addr, share);
                const nftAddress = await collection.getNFTAddress(index);
                expect(mintResult.transactions).toHaveTransaction({
                    to: collection.address,
                    success: true,
                    outMessagesCount: 1
                });
                expect(mintResult.transactions).toHaveTransaction({
                    from: collection.address,
                    to: nftAddress,
                    success: true,
                    deploy: true
                });
                expect(mintResult.transactions).toHaveTransaction({
                    from: nftAddress,
                    to: addr,
                    op: Op.ownership_assigned
                });
                index++;
            }
            const dataAfter = await collection.getCollectionData();
            expect(dataAfter.nextItemIndex).toEqual(index);
            snapshots.set("minted", blockchain.snapshot());
        });
        it("should not mint not from admin", async () => {
            await loadSnapshot("initialized");
            const mintResult = await collection.sendMint(notDeployer.getSender(), randomAddress(), getRandomTon(1, 100));
            expect(mintResult.transactions).toHaveTransaction({
                to: collection.address,
                success: false,
                exitCode: Errors.unauthorized_mint_request
            });
        });
        it("should not mint if uninitialized", async () => {
            await loadSnapshot("uninitialized");
            const mintResult = await collection.sendMint(deployer.getSender(), randomAddress(), getRandomTon(1, 100));
            expect(mintResult.transactions).toHaveTransaction({
                to: collection.address,
                success: false,
                exitCode: Errors.need_init
            });
        });
        it('should deploy item not from admin with failed init', async () => {
            await loadSnapshot("minted");
            const mintBody = PayoutCollection.mintMessage(notDeployer.address, getRandomTon(1, 100));
            const collectionData = await collection.getCollectionData();
            const index = collectionData.nextItemIndex;
            const nftAddress = await collection.getNFTAddress(index);
            const nftItem = blockchain.openContract(PayoutItem.createFromConfig({admin: collection.address, index}, itemCode));
            const mintResult = await blockchain.sendMessage(internal({
                from: notDeployer.address,
                to: nftAddress,
                value: toNano("0.3"),
                bounce: false,
                body: mintBody,
                stateInit: nftItem.init
            }));
            expect(mintResult.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: nftAddress,
                deploy: true,
                success: false,
                endStatus: 'active',
                exitCode: Errors.unauthorized_init
            });

            const nftSmc = await blockchain.getContract(nftItem.address);
            if (nftSmc.accountState?.type === 'active') {
                const initedBit = nftSmc.accountState?.state.data?.beginParse().loadBit();
                expect(initedBit).toEqual(false);
            } else throw Error(`Can't get state of ${nftItem.address}`);

            snapshots.set("uninited_item", blockchain.snapshot());
        });
        it('should init previously deployed item', async () => {
            await loadSnapshot("uninited_item");
            const collectionData = await collection.getCollectionData();
            const index = collectionData.nextItemIndex;
            const nftAddress = await collection.getNFTAddress(index);
            const mintResult = await collection.sendMint(deployer.getSender(), randomAddress(), getRandomTon(1, 100));
            expect(mintResult.transactions).toHaveTransaction({
                from: collection.address,
                to: nftAddress,
                success: true,
            });
            const nftItem = blockchain.openContract(PayoutItem.createFromAddress(nftAddress));
            const nftData = await nftItem.getNFTData();
            expect(nftData.inited).toEqual(true);
        });

        // TODO: test with minimal mint amount. Now collection doesn't check it and mint may fail on NFT side.

        it('nft may not be burned by owner or someONE else', async () => {
            await loadSnapshot("minted");
            const deployerNFTAddr = await collection.getNFTAddress(0n);
            const deployerNFT = blockchain.openContract(PayoutItem.createFromAddress(deployerNFTAddr));
            const { owner } = await deployerNFT.getNFTData();
            expect(owner.equals(deployer.address)).toEqual(true);
            const sendResult1 = await deployerNFT.sendBurn(deployer.getSender(), toNano('0.1'));
            const sendResult2 = await deployerNFT.sendBurn(notDeployer.getSender(), toNano('0.1'));
            for (let res of [sendResult1, sendResult2])
              expect(res.transactions).toHaveTransaction({ // burn notification
                  to: deployerNFTAddr,
                  success: false,
                  exitCode: Errors.unauthorized
              });
        });
        it('should not start distribution from not admin', async () => {
            await loadSnapshot("minted");
            const sendStartResult = await collection.sendStartDistribution(notDeployer.getSender(), toNano(1000));
            expect(sendStartResult.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: collection.address,
                success: false,
                exitCode: 80  // error::unauthorized_start_request
            });
        });
    });
});
