'use strict';

/**
 * db.js — DynamoDB operations for the API registry.
 * Tracks all APIs created through the web GUI.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_ACCOUNT_REGION })
);
const TABLE = process.env.DYNAMODB_TABLE;

/** Save a newly created API record */
async function saveApi(record) {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...record,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  }));
}

/** Get a single API record by name */
async function getApi(api_name) {
  const res = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { api_name },
  }));
  return res.Item ?? null;
}

/** List all API records */
async function listApis() {
  const res = await client.send(new ScanCommand({ TableName: TABLE }));
  return res.Items ?? [];
}

/** Delete an API record */
async function deleteApi(api_name) {
  await client.send(new DeleteCommand({
    TableName: TABLE,
    Key: { api_name },
  }));
}

/** Update status of an API record */
async function updateStatus(api_name, status, extra = {}) {
  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { api_name },
    UpdateExpression: 'SET #s = :s, updated_at = :u' +
      (Object.keys(extra).length ? ', ' + Object.keys(extra).map((k, i) => `#k${i} = :v${i}`).join(', ') : ''),
    ExpressionAttributeNames: {
      '#s': 'status',
      ...Object.fromEntries(Object.keys(extra).map((k, i) => [`#k${i}`, k])),
    },
    ExpressionAttributeValues: {
      ':s': status,
      ':u': new Date().toISOString(),
      ...Object.fromEntries(Object.keys(extra).map((k, i) => [`:v${i}`, extra[k]])),
    },
  }));
}

module.exports = { saveApi, getApi, listApis, deleteApi, updateStatus };

