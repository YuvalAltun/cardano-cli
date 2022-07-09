import { exec as cpExec, execSync } from 'child_process';
import { promises as fs, existsSync, readFileSync } from 'fs';
import { uuid } from 'uuidv4';
import Big from 'big.js';
import util from 'util';
// TODO: replace all the execSync With exec
const exec = util.promisify(cpExec);
import {
  ConstructorOptions,
  ProtocolParams,
  Tip,
  Utxo,
  Transaction,
  AddressBuildOptions,
  AddressInfo,
  CalculateMinFeeOptions,
  TransationSignOptions,
  TransactionWitnessOptions,
  TransactionAssembleOptions,
  TxOut,
  TransactionViewOptions,
} from './interfaces';
import mainnetShelleyGenesis from './genesis-files/mainnet-shelley-genesis.json';
import testnetShelleyGenesis from './genesis-files/testnet-shelley-genesis.json';
import {
  auxScriptToString,
  certToString,
  jsonToPath,
  mintToString,
  multiAssetToString,
  signingKeysToString,
  txInToString,
  txOutToString,
  withdrawalToString,
  witnessFilesToString,
} from './helpers';
import { JSONValue, Network } from './types';
export class CardanoCli {
  network: Network = 'mainnet';
  era = '';
  dir = '.';
  cliPath = 'cardano-cli';
  networkParam = '';
  shelleyGenesis: JSONValue = null;
  testnetMagic = '1097911063';
  protocolParametersPath = '';
  constructor(options: ConstructorOptions) {
    if (options) {
      options.socketPath &&
        (process.env['CARDANO_NODE_SOCKET_PATH'] = options.socketPath);
      options.era && (this.era = '--' + options.era + '-era');
      options.network && (this.network = options.network);
      options.dir && (this.dir = options.dir);
      options.cliPath && (this.cliPath = options.cliPath);
      options.testnetMagic && (this.testnetMagic = options.testnetMagic);
      if (options.shelleyGenesisPath) {
        this.shelleyGenesis = JSON.parse(
          readFileSync(options.shelleyGenesisPath).toString()
        );
      } else {
        if (this.network === 'mainnet') {
          this.shelleyGenesis = mainnetShelleyGenesis;
        } else {
          this.shelleyGenesis = testnetShelleyGenesis;
        }
      }
      this.network === 'mainnet'
        ? (this.networkParam = '--mainnet')
        : (this.networkParam = '--testnet-magic ');
    }
    const tempDir = `${this.dir}/tmp`;
    if (!existsSync(tempDir)) execSync(`mkdir -p ${tempDir}`);
  }
  // TODO: use exec
  // TODO: add blockfrost support
  // TODO: implemetet the rest of the methods
  queryTip(): Tip {
    const tip: Tip = JSON.parse(
      execSync(`${this.cliPath} query tip \
          ${this.network} \
          --cardano-mode
                          `).toString()
    );
    return tip;
  }

  queryProtocolParameters(): ProtocolParams {
    execSync(`${this.cliPath} query protocol-parameters \
                            ${this.network} \
                            --cardano-mode \
                            --out-file ${this.dir}/tmp/protocolParams.json
                        `);
    this.protocolParametersPath = `${this.dir}/tmp/protocolParams.json`;
    const protocolParams: ProtocolParams = JSON.parse(
      execSync(`cat ${this.dir}/tmp/protocolParams.json`).toString()
    );
    return protocolParams;
  }

  queryUtxo(address: string): Utxo[] {
    const utxosRaw = execSync(`${this.cliPath} query utxo \
            ${this.network} \
            --address ${address} \
            --cardano-mode
            `).toString();
    const utxos = utxosRaw.split('\n');
    utxos.splice(0, 1);
    utxos.splice(0, 1);
    utxos.splice(utxos.length - 1, 1);
    const utxosData = utxos.map((raw: string) => {
      const utxo = raw.replace(/\s+/g, ' ').split(' ');
      const txHash = utxo[0];
      const txId = parseInt(utxo[1]);
      const valueList = utxo.slice(2, utxo.length).join(' ').split('+');
      const value: { [key: string]: string } = {};
      let datumHash = '';
      valueList.forEach(v => {
        if (v.includes('TxOutDatumHash') || v.includes('TxOutDatumNone')) {
          if (!v.includes('None'))
            datumHash = JSON.parse(v.trim().split(' ')[2]);
          return;
        }
        const [quantity, asset] = v.trim().split(' ');
        value[asset] = quantity;
      });
      const utxoData: Utxo = { txHash, txId, value };
      if (datumHash) utxoData.datumHash = datumHash;

      return utxoData;
    });

    return utxosData;
  }

  async addressKeyGen(
    account: string
  ): Promise<{ vkeyFilePath: string; skeyFilePath: string }> {
    const vkeyFilePath = `${this.dir}/priv/wallet/${account}/${account}.payment.vkey`;
    const skeyFilePath = `${this.dir}/priv/wallet/${account}/${account}.payment.skey`;

    if (existsSync(vkeyFilePath))
      return Promise.reject(`${vkeyFilePath} file already exists`);
    if (existsSync(skeyFilePath))
      return Promise.reject(`${skeyFilePath} file already exists`);
    execSync(`mkdir -p ${this.dir}/priv/wallet/${account}`);
    execSync(`${this.cliPath} address key-gen \
                        --verification-key-file ${vkeyFilePath} \
                        --signing-key-file ${skeyFilePath}
                    `);
    return {
      vkeyFilePath,
      skeyFilePath,
    };
  }

  async transactionBuildRaw(options: Transaction): Promise<string> {
    if (!(options && options.txIn && options.txOut))
      return Promise.reject('TxIn and TxOut required');
    const fileUuid = uuid();
    const txInString = await txInToString(this.dir, options.txIn);
    const txOutString = txOutToString(options.txOut);
    const txInCollateralString = options.txInCollateral
      ? await txInToString(this.dir, options.txInCollateral, true)
      : '';
    const mintString = options.mint ? mintToString(this.dir, options.mint) : '';
    const withdrawals = options.withdrawals
      ? await withdrawalToString(this.dir, options.withdrawals)
      : '';
    const certs = options.certs
      ? await certToString(this.dir, options.certs)
      : '';
    const metadata = options.metadata
      ? '--metadata-json-file ' +
        (await jsonToPath(this.dir, options.metadata, 'metadata'))
      : '';
    const auxScript = options.auxScript
      ? await auxScriptToString(this.dir, options.auxScript)
      : '';

    if (!this.protocolParametersPath) this.queryProtocolParameters();
    const rawFilePath = `${this.dir}/tmp/tx_${fileUuid}.raw`;
    const scriptInvalid = options.scriptInvalid ? '--script-invalid' : '';
    execSync(`${this.cliPath} transaction build-raw \
                --babbage-era \
                ${txInString} \
                ${txOutString} \
                ${txInCollateralString} \
                ${certs} \
                ${withdrawals} \
                ${mintString} \
                ${auxScript} \
                ${metadata} \
                ${scriptInvalid} \
                --invalid-hereafter ${
                  options.invalidAfter
                    ? options.invalidAfter
                    : this.queryTip().slot + 10000
                } \
                --invalid-before ${
                  options.invalidBefore ? options.invalidBefore : 0
                } \
                --fee ${options.fee ? options.fee : 0} \
                --out-file ${rawFilePath} \
                --protocol-params-file ${this.protocolParametersPath} \
                ${this.era}`);

    return rawFilePath;
  }

  //   queryStakeAddressInfo(address: string): CardanocliJs.StakeAddressInfo[];
  //   stakeAddressKeyGen(account: string): CardanocliJs.Account;
  //   stakeAddressBuild(account: string): string;

  async addressBuild(
    account: string,
    options: AddressBuildOptions
  ): Promise<string> {
    const paymentVkey = options.paymentVkey
      ? `--payment-verification-key-file ${options.paymentVkey}`
      : '';
    const stakeVkey = options.stakeVkey
      ? `--staking-verification-key-file ${options.stakeVkey}`
      : '';
    const paymentScript = options.paymentScript
      ? `--payment-script-file ${await jsonToPath(
          this.dir,
          options.paymentScript
        )}`
      : '';
    const stakeScript = options.stakeScript
      ? `--stake-script-file ${await jsonToPath(this.dir, options.stakeScript)}`
      : '';

    execSync(`${this.cliPath} address build \
                    ${paymentVkey} \
                    ${stakeVkey} \
                    ${paymentScript} \
                    ${stakeScript} \
                    --out-file ${this.dir}/priv/wallet/${account}/${account}.payment.addr \
                    ${this.network}
                `);
    return `${this.dir}/priv/wallet/${account}/${account}.payment.addr`;
  }
  addressKeyHash(account: string): string {
    return execSync(`${this.cliPath} address key-hash \
                              --payment-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.payment.vkey \
                          `)
      .toString()
      .trim();
  }
  addressInfo(address: string): AddressInfo {
    const addressInfo: AddressInfo = JSON.parse(
      execSync(`${this.cliPath} address info \
              --address ${address} \
              `)
        .toString()
        .replace(/\s+/g, ' ')
    );
    return addressInfo;
  }
  async addressBuildScript(script: JSONValue): Promise<string> {
    const UID = uuid();
    await fs.writeFile(
      `${this.dir}/tmp/script_${UID}.json`,
      JSON.stringify(script)
    );
    const scriptAddr = execSync(
      `${this.cliPath} address build-script --script-file ${this.dir}/tmp/script_${UID}.json ${this.network}`
    )
      .toString()
      .replace(/\s+/g, ' ');
    return scriptAddr;
  }

  async transactionBuild(options: Transaction): Promise<string> {
    if (!(options && options.txIn && options.txOut))
      return Promise.reject('TxIn and TxOut required');
    const UID = uuid();
    const txInString = await txInToString(this.dir, options.txIn);
    const txOutString = txOutToString(options.txOut);
    const txInCollateralString = options.txInCollateral
      ? await txInToString(this.dir, options.txInCollateral, true)
      : '';
    const changeAddressString = options.changeAddress
      ? `--change-address ${options.changeAddress || ''}`
      : '';
    const mintString = options.mint ? mintToString(this.dir, options.mint) : '';
    const withdrawals = options.withdrawals
      ? await withdrawalToString(this.dir, options.withdrawals)
      : '';
    const certs = options.certs
      ? await certToString(this.dir, options.certs)
      : '';
    const metadata = options.metadata
      ? '--metadata-json-file ' +
        (await jsonToPath(this.dir, options.metadata, 'metadata'))
      : '';
    const auxScript = options.auxScript
      ? await auxScriptToString(this.dir, options.auxScript)
      : '';
    const scriptInvalid = options.scriptInvalid ? '--script-invalid' : '';
    const witnessOverride = options.witnessOverride
      ? // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `--witness-override ${options.witnessOverride}`
      : '';
    if (!this.protocolParametersPath) this.queryProtocolParameters();
    execSync(`${this.cliPath} transaction build \
                ${txInString} \
                ${txOutString} \
                ${txInCollateralString} \
                ${certs} \
                ${withdrawals} \
                ${mintString} \
                ${auxScript} \
                ${metadata} \
                ${scriptInvalid} \
                ${witnessOverride} \
                --invalid-hereafter ${
                  options.invalidAfter
                    ? options.invalidAfter
                    : this.queryTip().slot + 10000
                } \
                --invalid-before ${
                  options.invalidBefore ? options.invalidBefore : 0
                } \
                --out-file ${this.dir}/tmp/tx_${UID}.raw \
                ${changeAddressString} \
                ${this.network} \
                --protocol-params-file ${this.protocolParametersPath} \
                ${this.era}`);

    return `${this.dir}/tmp/tx_${UID}.raw`;
  }
  transactionCalculateMinFee(options: CalculateMinFeeOptions): string {
    this.queryProtocolParameters();
    return execSync(`${this.cliPath} transaction calculate-min-fee \
                      --tx-body-file ${options.txBody} \
                      --tx-in-count ${options.txIn.length} \
                      --tx-out-count ${options.txOut.length} \
                      ${this.network} \
                      --witness-count ${options.witnessCount} \
                      --protocol-params-file ${this.protocolParametersPath}`)
      .toString()
      .replace(/\s+/g, ' ')
      .split(' ')[0];
  }
  async transactionPolicyid(script: JSONValue): Promise<string> {
    const UID = uuid();
    await fs.writeFile(
      `${this.dir}/tmp/script_${UID}.json`,
      JSON.stringify(script)
    );
    return execSync(
      `${this.cliPath} transaction policyid --script-file ${this.dir}/tmp/script_${UID}.json`
    )
      .toString()
      .trim();
  }
  transactionHashScriptData(script: JSONValue): string {
    return execSync(
      `${
        this.cliPath
      } transaction hash-script-data --script-data-value '${JSON.stringify(
        script
      )}'`
    )
      .toString()
      .trim();
  }
  transactionSign(options: TransationSignOptions): string {
    const UID = uuid();
    const signingKeys = signingKeysToString(options.signingKeys);
    execSync(`${this.cliPath} transaction sign \
        --tx-body-file ${options.txBody} \
        ${this.network} \
        ${signingKeys} \
        --out-file ${this.dir}/tmp/tx_${UID}.signed`);
    return `${this.dir}/tmp/tx_${UID}.signed`;
  }
  transactionWitness(options: TransactionWitnessOptions): string {
    const UID = uuid();
    if (!options.signingKey && !options.scriptFile) {
      throw new Error(
        'script-file or signing-key required for transaction witness command'
      );
    }
    let signingParams = '';
    if (options.scriptFile) {
      signingParams += `--script-file ${options.scriptFile} `;
    }
    if (options.signingKey) {
      signingParams += `--signing-key-file ${options.signingKey}`;
    }
    execSync(`${this.cliPath} transaction witness \
        --tx-body-file ${options.txBody} \
        --${this.network} \
        --out-file ${this.dir}/tmp/tx_${UID}.witness \
        ${signingParams}`);
    return `${this.dir}/tmp/tx_${UID}.witness`;
  }
  transactionAssemble(options: TransactionAssembleOptions): string {
    const UID = uuid();
    const witnessFiles = witnessFilesToString(options.witnessFiles);
    const filePath = `${this.dir}/tmp/tx_${UID}.signed`;
    execSync(`${this.cliPath} transaction assemble \
        --tx-body-file ${options.txBody} \
        ${witnessFiles} \
        --out-file ${filePath}`);
    return filePath;
  }
  transactionCalculateMinValue(options: TxOut): string {
    this.queryProtocolParameters();
    const multiAsset = multiAssetToString(options);
    return execSync(`${this.cliPath} transaction calculate-min-required-utxo \
                --tx-out ${multiAsset} \
                --protocol-params-file ${this.protocolParametersPath}`)
      .toString()
      .replace(/\s+/g, ' ')
      .split(' ')[1];
  }
  transactionCalculateMinRequiredUtxo(address: string, value: TxOut): string {
    this.queryProtocolParameters();
    const multiAsset = multiAssetToString(value);
    return execSync(`${this.cliPath} transaction calculate-min-required-utxo \
                --babbage-era \
                --tx-out ${address}+${multiAsset} \
                --protocol-params-file ${this.protocolParametersPath}`)
      .toString()
      .replace(/\s+/g, ' ')
      .split(' ')[1];
  }
  async transactionSubmit(tx: string): Promise<string> {
    const UID = uuid();
    let parsedTx;

    if (typeof tx === 'object') {
      await fs.writeFile(
        `${this.dir}/tmp/tx_${UID}.signed`,
        JSON.stringify(tx)
      );
      parsedTx = `${this.dir}/tmp/tx_${UID}.signed`;
    } else {
      parsedTx = tx;
    }
    execSync(
      `${this.cliPath} transaction submit ${this.network} --tx-file ${parsedTx}`
    );
    return this.transactionTxid({ txFile: parsedTx });
  }
  transactionTxid(options: TransactionViewOptions): string {
    const txArg = options.txBody
      ? `--tx-body-file ${options.txBody}`
      : `--tx-file ${options.txFile || ''}`;
    return execSync(`${this.cliPath} transaction txid ${txArg}`)
      .toString()
      .trim();
  }
  transactionView(options: TransactionViewOptions): string {
    const txArg = options.txBody
      ? `--tx-body-file ${options.txBody}`
      : `--tx-file ${options.txFile || ''}`;
    return execSync(`${this.cliPath} transaction view ${txArg}`)
      .toString()
      .trim();
  }

  toLovelace(ada: string): string {
    const lovelace = new Big(ada).mul('1e6');
    return lovelace.toFixed();
  }
  toAda(lovelace: string): string {
    const ada = new Big(lovelace).mul('1e-6');
    return ada.toFixed();
  }

  // TODO: implement later

  //   KESPeriod(): number;
  // getDownloadUrl(filePath: string): string;

  //   wallet(account: string): CardanocliJs.Wallet;

  //   pool(poolName: string): CardanocliJs.Pool;

  //   stakeAddressRegistrationCertificate(account: string): string;
  //   stakeAddressDeregistrationCertificate(accout: string): string;
  //   stakeAddressDelegationCertificate(account: string, poolId: string): string;
  //   stakeAddressKeyHash(account: string): string;

  //   nodeKeyGenKES(poolName: string): CardanocliJs.Account;
  //   nodeKeyGen(poolName: string): CardanocliJs.Account;
  //   nodeIssueOpCert(poolName: string, kesPeriod: number): string;
  //   nodeKeyGenVRF(poolName: string): CardanocliJs.Account;
  //   nodeNewCounter(poolName: string, counter: string): string;

  //   stakePoolId(poolName: string): string;
  //   stakePoolMetadataHash(metadata: string): string;
  //   stakePoolRegistrationCertificate(
  //     poolName: string,
  //     options: CardanocliJs.StakePoolRegistrationOptions
  //   ): string;
  //   stakePoolDeregistrationCertificate(poolName: string, epoch: number): string;
}

// const cardanoCli = new CardanoCli({ network: '--testnet-magic 1097911063' });
// console.log(cardanoCli.cliPath);
// cardanoCli
//   .addressKeyGen('tamir')
//   .then(x => {
//     console.log(x);
//   })
//   .catch(error => {
//     console.log(error);
//   });
