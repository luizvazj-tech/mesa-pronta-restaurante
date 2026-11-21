import dynalite from 'dynalite';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createApp } from '../src/handler.mjs';

export async function makeBackend(opts = {}) {
  const server = dynalite({ createTableMs: 0 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const client = new DynamoDBClient({ endpoint: `http://127.0.0.1:${port}`, region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'x' } });
  await client.send(new CreateTableCommand({
    TableName: 'mesa-pronta-test', BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }, { AttributeName: 'GSI1PK', AttributeType: 'S' }, { AttributeName: 'GSI1SK', AttributeType: 'N' }],
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
    GlobalSecondaryIndexes: [{ IndexName: 'GSI1', KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }, { AttributeName: 'GSI1SK', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } }],
  }));
  const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  let clock = Date.now();
  const app = createApp({ doc, table: 'mesa-pronta-test', getSecret: async () => 'segredo-de-teste', now: () => clock, fetchFn: opts.fetchFn, signupEnabled: true });
  const call = async (method, path, { body, token, query } = {}) => {
    const r = await app({ requestContext: { http: { method } }, rawPath: path, headers: token ? { authorization: 'Bearer ' + token } : {}, queryStringParameters: query, body: body ? JSON.stringify(body) : undefined });
    return { status: r.statusCode, data: r.body ? JSON.parse(r.body) : null };
  };
  return { call, advance: ms => { clock += ms; }, close: () => new Promise(r => server.close(r)) };
}
