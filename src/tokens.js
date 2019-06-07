/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import transaction from './transaction';
import wallet from './wallet';
import storage from './storage';
import { crypto, util } from 'bitcore-lib';
import walletApi from './api/wallet';
import { AddressError, OutputValueError } from './errors';
import buffer from 'buffer';
import { HATHOR_TOKEN_CONFIG, TOKEN_CREATION_MASK, TOKEN_MINT_MASK, TOKEN_MELT_MASK, AUTHORITY_TOKEN_DATA } from './constants';


/**
 * Methods to create and handle tokens
 *
 * @namespace Tokens
 */

const tokens = {
  /**
   * Create a token UID from the tx_id and index that the tx is spending to create the token
   *
   * @param {string} txID Transaction id in hexadecimal of the output that is being spent when creating the token
   * @param {number} index Index of the output that is being spent when creating the token
   *
   * @return {Buffer} UID of the token in bytes
   *
   * @memberof Tokens
   * @inner
   */
  getTokenUID(txID, index) {
    let arr = [];
    arr.push(util.buffer.hexToBuffer(txID));
    arr.push(transaction.intToBytes(index, 1));
    return crypto.Hash.sha256(util.buffer.concat(arr));
  },

  /**
   * Add a new token to the storage and redux
   *
   * @param {string} uid Token uid
   * @param {string} name Token name
   * @param {string} symbol Token synbol
   *
   * @return {Array} array of token configs with new added one
   *
   * @memberof Tokens
   * @inner
   */
  addToken(uid, name, symbol) {
    const newConfig = {'name': name, 'symbol': symbol, 'uid': uid};
    let tokens = this.getTokens();
    tokens.push(newConfig);
    this.saveToStorage(tokens);
    return tokens;
  },

  /**
   * Edit token name and symbol. Save in storage and redux
   *
   * @param {string} uid Token uid to be edited
   * @param {string} name New token name
   * @param {string} synbol New token symbol
   *
   * @return {Array} array of token configs with edited one
   *
   * @memberof Tokens
   * @inner
   */
  editToken(uid, name, symbol) {
    const tokens = this.getTokens();
    const filteredTokens = tokens.filter((token) => token.uid !== uid);
    const newConfig = {uid, name, symbol};
    const editedTokens = [...filteredTokens, newConfig];
    this.saveToStorage(editedTokens);
    return editedTokens;
  },

  /**
   * Unregister token from storage and redux
   *
   * @param {string} uid Token uid to be unregistered
   *
   * @return {Array} array of token configs without the unregister one
   *
   * @memberof Tokens
   * @inner
   */
  unregisterToken(uid) {
    const tokens = this.getTokens();
    const filteredTokens = tokens.filter((token) => token.uid !== uid);
    this.saveToStorage(filteredTokens);
    return filteredTokens;
  },

  /**
   * Validation token by configuration string
   * Check if string is valid and, if uid is passed, check also if uid matches
   *
   * @param {string} config Token configuration string
   * @param {string} uid Uid to check if matches with uid from config (optional)
   *
   * @return {Object} {success: boolean, message: in case of failure, tokenData: object with token data in case of success}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByConfigurationString(config, uid) {
    const tokenData = this.getTokenFromConfigurationString(config);
    if (tokenData === null) {
      return {success: false, message: 'Invalid configuration string'};
    }
    if (uid && uid !== tokenData.uid) {
      return {success: false, message: `Configuration string uid does not match: ${uid} != ${tokenData.uid}`};
    }

    const validation = this.validateTokenToAddByUid(tokenData.uid);
    if (validation.success) {
      return {success: true, tokenData: tokenData};
    } else {
      return validation;
    }
  },

  /**
   * Validation token by uid. Check if already exist
   *
   * @param {string} uid Uid to check for existence
   *
   * @return {Object} {success: boolean, message: in case of failure}
   *
   * @memberof Tokens
   * @inner
   */
  validateTokenToAddByUid(uid) {
    const existedToken = this.tokenExists(uid);
    if (existedToken) {
      return {success: false, message: `You already have this token: ${uid} (${existedToken.name})`};
    }

    return {success: true};
  },

  /**
   * Returns the saved tokens in storage
   *
   * @return {Object} Array of objects ({'name', 'symbol', 'uid'}) of saved tokens
   *
   * @memberof Tokens
   * @inner
   */
  getTokens() {
    let dataToken = storage.getItem('wallet:tokens');
    if (!dataToken) {
      dataToken = [HATHOR_TOKEN_CONFIG];
    }
    return dataToken;
  },

  /**
   * Updates the saved tokens in storage
   *
   * @param {Object} Array of objects ({'name', 'symbol', 'uid'}) with new tokens
   *
   * @memberof Tokens
   * @inner
   *
   */
  saveToStorage(newTokens) {
    storage.setItem('wallet:tokens', newTokens);
  },

  /**
   * Returns token configuration string
   *
   * @param {string} uid Token uid
   * @param {string} name Token name
   * @param {string} symbol Token symbol
   *
   * @return {string} Configuration string of the token
   *
   * @memberof Tokens
   * @inner
   *
   */
  getConfigurationString(uid, name, symbol) {
    const partialConfig = `${name}:${symbol}:${uid}`;
    const checksum = transaction.getChecksum(buffer.Buffer.from(partialConfig));
    return `[${partialConfig}:${checksum.toString('hex')}]`;
  },

  /**
   * Returns token from configuration string
   * Configuration string has the following format:
   * [name:symbol:uid:checksum]
   *
   * @param {string} config Configuration string with token data plus a checksum
   *
   * @return {Object} token {'uid', 'name', 'symbol'} or null in case config is invalid
   *
   * @memberof Tokens
   * @inner
   *
   */
  getTokenFromConfigurationString(config) {
    // First we validate that first char is [ and last one is ]
    if (!config || config[0] !== '[' || config[config.length - 1] !== ']') {
      return null;
    }
    // Then we remove the [] and split the string by :
    const configArr = config.slice(1, -1).split(':');
    if (configArr.length < 4) {
      return null;
    }

    // Last element is the checksum
    const checksum = configArr.splice(-1);
    const configWithoutChecksum = configArr.join(':');
    const correctChecksum = transaction.getChecksum(buffer.Buffer.from(configWithoutChecksum));
    if (correctChecksum.toString('hex') !== checksum[0]) {
      return null;
    }
    const uid = configArr.pop();
    const symbol = configArr.pop();
    // Assuming that the name might have : on it
    const name = configArr.join(':');
    return {uid, name, symbol};
  },

  /**
   * Indicates if a token with this uid was already added in the wallet
   *
   * @param {string} uid UID of the token to search
   *
   * @return {Object|null} Token if uid already exists, else null
   *
   * @memberof Tokens
   * @inner
   */
  tokenExists(uid) {
    const tokens = this.getTokens();
    for (const token of tokens) {
      if (token.uid === uid) {
        return token;
      }
    }
    return null;
  },

  /**
   * Create the tx for the new token in the backend and creates a new mint and melt outputs to be used in the future
   *
   * @param {Object} input {'tx_id', 'index', 'token'} Hathor input to be spent to generate the token
   * @param {Object} output {'address', 'value', 'tokenData'} Hathor output to get the change of the input that generated the token
   * @param {string} address Address to receive the amount of the generated token
   * @param {string} name Name of the new token
   * @param {string} symbol Symbol of the new token
   * @param {number} mintAmount Amount of the new token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   *
   * @return {Promise} Promise that resolves when token is created or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  createToken(input, output, address, name, symbol, mintAmount, pin) {
    // Create authority output
    // First the tokens masks that will be the value for the authority output
    const tokenMasks = TOKEN_CREATION_MASK | TOKEN_MINT_MASK | TOKEN_MELT_MASK;
    // Create token uid
    const tokenUID = this.getTokenUID(input.tx_id, input.index);
    const authorityOutput = {'address': address, 'value': tokenMasks, 'tokenData': AUTHORITY_TOKEN_DATA};

    // Create tx data
    let txData = {'inputs': [input], 'outputs': [authorityOutput, output], 'tokens': [tokenUID]};
    const promise = new Promise((resolve, reject) => {
      const txPromise = transaction.sendTransaction(txData, pin);
      txPromise.then((response) => {
        // Save in storage and redux new token configuration
        this.addToken(response.tx.tokens[0], name, symbol);
        console.log('VAI MINTAR, CARALHo', response);
        const mintPromise = this.mintTokens(response.tx.hash, 0, address, response.tx.tokens[0], address, mintAmount, pin, true, true);
        mintPromise.then(() => {
          resolve({uid: response.tx.tokens[0], name, symbol});
        }, (message) => {
          reject(message);
        });
      }, (e) => {
        reject(e.message);
      });
    });
    return promise;
  },

  /**
   * Mint new tokens
   *
   * @param {string} txId Hash of the transaction to be used to mint tokens
   * @param {number} index Index of the output being spent
   * @param {string} addressSpent Address of the output being spent
   * @param {string} token Token uid to be minted
   * @param {string} address Address to receive the amount of the generated token
   * @param {number} amount Amount of the new token that will be minted
   * @param {string} pin Pin to generate new addresses, if necessary
   * @param {boolean} createAnotherMint If should create another mint output after spending this one
   *
   * @return {Promise} Promise that resolves when token is minted or an error from the backend arrives
   *
   * @memberof Tokens
   * @inner
   */
  mintTokens(txID, index, addressSpent, token, address, amount, pin, createAnotherMint, createMelt) {
    const input = {'tx_id': txID, 'index': index, 'token': token, 'address': addressSpent};
    // Output1: Mint token amount
    const outputs = [{'address': address, 'value': amount, 'tokenData': 1}];

    if (createAnotherMint) {
      // Output2: new mint authority
      outputs.push({'address': address, 'value': TOKEN_MINT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    if (createMelt) {
      // We create a melt output when creating the token
      outputs.push({'address': address, 'value': TOKEN_MELT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    let newTxData = {'inputs': [input], 'outputs': outputs, 'tokens': [token]};
    return transaction.sendTransaction(newTxData, pin);
  },

  meltTokens(txId, index, addressSpent, token, amount, pin, createAnotherMelt) {
    const result = this.getMeltInputs(amount, token);
    // Can't find inputs to this amount
    if (result === null) return null;

    // First adding authority input with MELT capability
    const authorityInput = {'tx_id': txId, 'index': index, 'token': token, 'address': addressSpent};
    const inputs = [authorityInput, ...result.inputs];
    const outputs = [];
    const tokens = [token];

    if (result.inputsAmount > amount) {
      // Need to create change output
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': result.inputsAmount - amount, 'tokenData': 1});
    }

    if (createAnotherMelt) {
      // New melt authority
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': TOKEN_MELT_MASK, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    let newTxData = {inputs, outputs, tokens};
    console.log('Melt tokens', newTxData);
    return transaction.sendTransaction(newTxData, pin);
  },

  getMeltInputs(amount, token) {
    const data = wallet.getWalletData();
    if (data === null) {
      return null;
    }

    const inputs = [];
    let inputsAmount = 0;
    const filteredHistory = wallet.filterHistoryTransactions(data.historyTransactions, token);

    for (const tx of filteredHistory) {
      if (tx.is_voided) {
        // Ignore voided transactions.
        continue;
      }
      for (const [index, txout] of tx.outputs.entries()) {
        if (wallet.isAuthorityOutput(txout)) {
          // Ignore authority outputs.
          continue;
        }
        if (txout.spent_by === null && txout.token === token && wallet.isAddressMine(txout.decoded.address, data)) {
          inputs.push({'tx_id': tx.tx_id, 'index': index, 'token': token, 'address': txout.decoded.address});
          inputsAmount += txout.value;

          if (inputsAmount >= amount) {
            return {inputs, inputsAmount};
          }
        }
      }
    }

    return null;
  },

  delegateAuthority(txID, index, addressSpent, token, address, createAnother, type, pin) {
    const input = {'tx_id': txID, 'index': index, 'token': token, 'address': addressSpent};

    console.log('Delegate 1 ', type);
    const outputValue = type === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK;

    // Output1: Delegated output
    const outputs = [{'address': address, 'value': outputValue, 'tokenData': AUTHORITY_TOKEN_DATA}];

    if (createAnother) {
      // Output2: new authority for this wallet
      const newAddress = wallet.getAddressToUse();
      outputs.push({'address': newAddress, 'value': outputValue, 'tokenData': AUTHORITY_TOKEN_DATA});
    }

    // Create new data
    let newTxData = {'inputs': [input], 'outputs': outputs, 'tokens': [token]};
    console.log('Delegate ', newTxData);
    return transaction.sendTransaction(newTxData, pin);
  },

  destroyAuthority(data, pin) {
    console.log('Destroy authority', data);
    // Create new data
    let newTxData = {'inputs': data, 'outputs': [], 'tokens': []};
    return transaction.sendTransaction(newTxData, pin);
  },

  /**
   * Filter an array of tokens removing one element
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} toRemove Config of the token to be removed
   *
   * @return {Object} Array of token configs filtered
   *
   * @memberof Tokens
   * @inner
   */
  filterTokens(tokens, toRemove) {
    return tokens.filter((token) => token.uid !== toRemove.uid);
  },

  /**
   * Gets the token index to be added to the tokenData in the output from tx
   *
   * @param {Object} tokens Array of token configs
   * @param {Object} uid Token uid to return the index
   *
   * @return {number} Index of token to be set as tokenData in output tx
   *
   * @memberof Tokens
   * @inner
   */
  getTokenIndex(tokens, uid) {
    // If token is Hathor, index is always 0
    // Otherwise, it is always the array index + 1
    if (uid === HATHOR_TOKEN_CONFIG.uid) {
      return 0;
    } else {
      const tokensWithoutHathor = this.filterTokens(tokens, HATHOR_TOKEN_CONFIG);
      const myIndex = tokensWithoutHathor.findIndex((token) => token.uid === uid);
      return myIndex + 1;
    }
  }
}

export default tokens;
