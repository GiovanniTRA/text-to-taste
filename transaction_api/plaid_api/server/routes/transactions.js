const express = require("express");
const { getLoggedInUserId } = require("../utils");
const db = require("../db");
const { plaidClient } = require("../plaid");
const { setTimeout } = require("timers/promises");
const { SimpleTransaction } = require("../simpleTransactionObject");
const res = require("express/lib/response");

const router = express.Router();

/**
 * This will ask our server to make a transactions sync call
 * against all the items it has for a particular user. This is one way
 * you can keep your transaction data up to date, but it's preferable
 * to just fetch data for a single item in response to a webhook.
 */
router.post("/sync", async (req, res, next) => {
  try {
    const userId = getLoggedInUserId(req);
    const items = await db.getItemIdsForUser(userId);
    const fullResults = await Promise.all(
      items.map(async (item) => {
        return await syncTransactions(item.id);
      })
    );
    res.json({completeResults: fullResults});
    items.forEach(item => {
      syncTransactions(item.id);
    });
  } catch (error) {
    console.log(`Running into an error!`);
    next(error);
  }
});

const fetchNewSyncData = async function (accessToken, initialCursor){
  let keepGoing=false;
  const allData = {added:[], modified: [], removed:[],  nextCursor: initialCursor};
  do{
    const results  = await plaidClient.transactionsSync({
      access_token:accessToken,
      cursor: allData.nextCursor,
      options: {
        include_personal_finance_category:true,
      }
    });
    const newData = results.data;
    allData.added = allData.added.concat(newData.added);
    allData.modified = allData.modified.concat(newData.modified);
    allData.removed = allData.removed.concat(newData.removed);
    allData.nextCursor = newData.next_cursor;
    keepGoing = newData.has_more;
    console.log(
      `Added: ${newData.added.length} Modified: ${newData.modified.length} Removed: ${newData.removed.length}`
    );

  }while(keepGoing===true)
  console.log(`All done!`);
  console.log(`Your final cursor:${allData.nextCursor} `);

  return allData;
}

/**
 * Given an item ID, this will fetch all transactions for all accounts
 * associated with this item using the sync API. We can call this manually
 * using the /sync endpoint above, or we can call this in response
 * to a webhook
 */
const syncTransactions = async function (itemId) {
  const summary = { added: 0, removed: 0, modified: 0 };
  //1. Fetch our most recent cursor from the database
  const {access_token:accessToken, transaction_cursor:transactionCursor, user_id: userId} = await db.getItemInfo(itemId);

  //2. Fetch all our transactions since the last cursor
  const allData = await fetchNewSyncData(accessToken, transactionCursor);
  //3. Add new transactions to our database
  await Promise.all(
    allData.added.map(async (txnObj) => {
    const simpleTransaction = SimpleTransaction.fromPlaidTransaction(txnObj, userId)
    //console.log(`I want to add ${JSON.stringify(simpleTransaction)}`);
    const result = await db.addNewTransaction(simpleTransaction);
    console.log(JSON.stringify(result))
    if(result){
      summary.added += result.changes;
    }
  })
  );
  //4. Update any modified transactions
  await Promise.all(
    allData.modified.map(async (txnObj) => {
    const simpleTransaction = SimpleTransaction.fromPlaidTransaction(txnObj, userId)
    //console.log(`I want to add ${JSON.stringify(simpleTransaction)}`);
    const result = await db.modifyExistingTransaction(simpleTransaction);
    console.log(JSON.stringify(result))
    if(result){
      summary.modified += result.changes;
    }
  })
  );
  //5. Do something with removed transactions
  await Promise.all(
    allData.removed.map(async (txnMini) => {
    //const result = await db.deleteExistingTransaction(txnMini.transaction_id);
    const result = await db.markTransactionAsRemoved(txnMini.transaction_id);
    if(result){
      summary.removed += result.changes;
    }
    })
  );
  //6. Save our most recent cursor
  await db.saveCursorForItem(allData.nextCursor, itemId);

  return summary;
};

/**
 * Fetch all the transactions for a particular user (up to a limit)
 * This is really just a simple database query, since our server has already
 * fetched these items using the syncTransactions call above
 *
 */
router.get("/list", async (req, res, next) => {
  try { 
    const userId = getLoggedInUserId(req);
    const maxCount = req.params.maxCount ?? 50;
    const transactions = await db.getTransactionsForUser(userId, maxCount);
    res.json(transactions);
  } catch (error) {
    console.log(`Running into an error!`);
    next(error);
  }
});

module.exports = { router, syncTransactions };
