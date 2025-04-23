import { execSync } from 'child_process';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { generateMnemonic, mnemonicToSeedSync } from 'bip39';
import { networks, payments } from 'bitcoinjs-lib';

// Initialize crypto libraries
const bip32 = BIP32Factory(ecc);
const network = networks.regtest;
const WALLET_NAME = 'caravan_test_wallet';
const RPC_USER = 'user';  
const RPC_PASS = 'pass';  

// Wait for bitcoind to be ready
function waitForBitcoind() {
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
        try {
            execSync(`bitcoin-cli -regtest -rpcport=18443 -rpcuser=${RPC_USER} -rpcpassword=${RPC_PASS} getblockchaininfo`, {
                stdio: 'ignore'
            });
            return true;
        } catch (e) {
            attempts++;
            if (attempts >= maxAttempts) {
                console.error('Could not connect to bitcoind after multiple attempts');
                process.exit(1);
            }
            console.log('Waiting for bitcoind to start...');
            execSync('sleep 1'); // Wait 1 second between attempts
        }
    }
}


function createWallet(name: string): any {
    try {
        
        const cmd = `bitcoin-cli -regtest -rpcport=18443 -rpcuser=${RPC_USER} -rpcpassword=${RPC_PASS} createwallet '${name}' false false`;
        console.log(`Executing: ${cmd}`);
        const result = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
        return result ? JSON.parse(result) : {};
    } catch (error: any) {
        console.error(`Failed to create wallet: ${name}`);
        if (error.stderr) console.error(error.stderr.toString());
        throw error;
    }
}

// RPC handler with wallet selection
function rpc(method: string, params: any[] = []): any {
    try {
        const cmd = `bitcoin-cli -regtest -rpcport=18443 -rpcuser=${RPC_USER} -rpcpassword=${RPC_PASS} -rpcwallet=${WALLET_NAME} ${method} ${params.map(p => typeof p === 'string' ? `"${p}"` : `'${JSON.stringify(p)}'`).join(' ')}`;
        console.log(`Executing: ${cmd}`);
        const result = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
        
        // If the result starts with 'bcrt1' or other address format, return it directly
        if (result.startsWith('bcrt1') || result.match(/^[a-zA-Z0-9]{26,35}$/)) {
            return result;
        }
        
        //  parse as JSON, but if it fails, return the raw result
        try {
            return result ? JSON.parse(result) : {};
        } catch (jsonError) {
            return result;
        }
    } catch (error: any) {
        console.error(`RPC command failed: ${method} ${params.join(' ')}`);
        if (error.stderr) console.error(error.stderr.toString());
        throw error;
    }
}
async function setupMultisig() {
    try {
        waitForBitcoind();
        console.log('Connected to bitcoind');

        // 1. Create or load wallet
        try {
            createWallet(WALLET_NAME);
            console.log(`Created wallet: ${WALLET_NAME}`);
        } catch (error: any) {
            if (error.stderr && error.stderr.toString().includes('already exists')) {
                console.log('Wallet exists, loading...');
                try {
                    execSync(`bitcoin-cli -regtest -rpcport=18443 -rpcuser=${RPC_USER} -rpcpassword=${RPC_PASS} loadwallet '${WALLET_NAME}'`);
                    console.log(`Loaded wallet: ${WALLET_NAME}`);
                } catch (error) {
                    console.error('Failed to load wallet:', error);
                    throw error;
                }
            } else {
                throw error;
            }
        }

        // 2. Generate deterministic keys
        const MNEMONIC = generateMnemonic(256);
        const SEED = mnemonicToSeedSync(MNEMONIC);
        const root = bip32.fromSeed(SEED, network);

        // const pubkeys = [
        //     root.derivePath("m/48'/1'/0'/2'/0").publicKey,
        //     root.derivePath("m/48'/1'/0'/2'/1").publicKey,
        //     root.derivePath("m/48'/1'/0'/2'/2").publicKey
        // ];

        // // 3. Create multisig address
        // const { address } = payments.p2wsh({
        //     redeem: payments.p2ms({ m: 2, pubkeys, network }),
        //     network
        // });

        // console.log(`Created multisig address: ${address}`);
        

        // // 4. Fund the wallet
        // console.log('Generating mining address...');
        // const miner = rpc('getnewaddress');
        // console.log(`Mining address: ${miner}`);
        
        // console.log('Mining initial blocks...');
        // rpc('generatetoaddress', [101, miner]);
        
        // console.log(`Sending 10 BTC to multisig address: ${address}`);
        // rpc('sendtoaddress', [address, 10]);
        
        // console.log('Mining confirmation block...');
        // rpc('generatetoaddress', [1, miner]);

        // // 5. Create transaction history
        // console.log('Creating transaction history...');
        // for (let i = 0; i < 5; i++) {
        //     console.log(`Creating transaction ${i+1}/5...`);
        //     const recipient = rpc('getnewaddress');
        //     rpc('sendtoaddress', [recipient, 1]);
        //     rpc('generatetoaddress', [1, miner]);
        // }

        // console.log('Setup completed successfully');
        // console.log(`Mnemonic: ${MNEMONIC}`);
        // console.log(`Multisig Address: ${address}`);


        const accounts = [
            root.derivePath("m/48'/1'/0'/2'"),
            root.derivePath("m/48'/1'/1'/2'"),
            root.derivePath("m/48'/1'/2'/2'")
        ];

        const pubkeys = accounts.map((account) => account.publicKey);
        const xpubs = accounts.map((account) => account.neutered().toBase58());

         // Create a 2-of-3 multisig address
        const p2ms = payments.p2ms({ m: 2, pubkeys, network });
        const { address } = payments.p2wsh({ redeem: p2ms, network });
        console.log(` Created 2-of-3 P2WSH multisig address: ${address}`);

        // Fund it on regtest
        const minerAddress = rpc('getnewaddress');
        console.log(`Mining address: ${minerAddress}`);

        rpc('generatetoaddress', [101, minerAddress]);

        console.log(`Sending 10 BTC to multisig address: ${address}`);
        rpc('sendtoaddress', [address, 10]);
        rpc('generatetoaddress', [1, minerAddress]);

        // Create a few transaction history entries
        console.log('Creating transaction history...');
        for (let i = 0; i < 5; i++) {
            const recipient = rpc('getnewaddress');
            rpc('sendtoaddress', [recipient, 1]);
            rpc('generatetoaddress', [1, minerAddress]);
        }

        console.log('\n Setup completed successfully');
        console.log(' Seed Phrase (Mnemonic):\n', MNEMONIC);
        console.log(' Multisig Address:', address);

        // Output Caravan-compatible XPUB config
        console.log('\n Caravan Multisig Configuration:\n');
        console.log(
            JSON.stringify(
            {
                xpubs,
                quorum: {
                requiredSigners: 2,
                totalSigners: 3
                },
                network: 'regtest'
            },
            null,
            2
            )
        );

    } catch (error: any) {
        console.error('Setup failed:', error.message || error);
        process.exit(1);
    }
}

// Run the setup
setupMultisig();

//Run this command
//bitcoin-cli stop || pkill bitcoind; sleep 2; rm -rf ~/.bitcoin/regtest && bitcoind -regtest -daemon && sleep 5 && npx ts-node bootstrapMultisig.ts




